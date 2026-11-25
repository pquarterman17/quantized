"""IIR design / application oracles: scipy.signal directly plus closed-form results."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import signal

from quantized.calc.iir_filter import apply_iir, design_iir, frequency_response
from quantized.calc.spectral_workbench import spectral_workbench
from quantized.datastruct import DataStruct

FS = 100.0


def _gain_at(sos: np.ndarray, freq: float) -> float:
    _, h = signal.sosfreqz(sos, worN=[freq], fs=FS)
    return float(np.abs(h[0]))


def test_butterworth_poles_match_the_analytic_bilinear_locations() -> None:
    # Oppenheim & Schafer ch. 7: analog poles s_k = wc*exp(j*pi*(2k+n-1)/(2n)),
    # bilinear map with pre-warped cutoff wc = 2*fs*tan(pi*fc/fs), z = (2fs+s)/(2fs-s).
    n, fc = 4, 12.0
    sos = design_iir(family="butter", btype="lowpass", order=n, cutoff=[fc], fs=FS)
    wc = 2 * FS * np.tan(np.pi * fc / FS)
    k = np.arange(1, n + 1)
    s = wc * np.exp(1j * np.pi * (2 * k + n - 1) / (2 * n))
    expected = (2 * FS + s) / (2 * FS - s)
    _, poles, _ = signal.sos2zpk(sos)
    order = lambda z: sorted(z, key=lambda v: (round(v.real, 9), round(v.imag, 9)))  # noqa: E731
    np.testing.assert_allclose(order(poles), order(expected), atol=1e-9)
    assert np.all(np.abs(poles) < 1.0)  # stable


@pytest.mark.parametrize("order", [1, 2, 5, 8])
@pytest.mark.parametrize("btype,cut", [("lowpass", [10.0]), ("highpass", [10.0])])
def test_butterworth_is_3_01_db_down_at_the_cutoff(
    order: int, btype: str, cut: list[float]
) -> None:
    # |H(wc)|^2 = 1/(1+1) for every order: -10*log10(2) = -3.0103 dB.
    sos = design_iir(family="butter", btype=btype, order=order, cutoff=cut, fs=FS)
    assert 20 * np.log10(_gain_at(sos, cut[0])) == pytest.approx(-10 * np.log10(2), abs=1e-6)


def test_butterworth_bandpass_edges_are_3_01_db_down() -> None:
    sos = design_iir(family="butter", btype="bandpass", order=3, cutoff=[8.0, 20.0], fs=FS)
    for edge in (8.0, 20.0):
        assert 20 * np.log10(_gain_at(sos, edge)) == pytest.approx(-10 * np.log10(2), abs=1e-6)


@pytest.mark.parametrize("family", ["butter", "cheby1", "cheby2", "ellip", "bessel"])
@pytest.mark.parametrize("btype", ["lowpass", "highpass", "bandpass", "bandstop"])
def test_design_matches_scipy_sos_exactly(family: str, btype: str) -> None:
    cut = [10.0, 25.0] if btype in ("bandpass", "bandstop") else [10.0]
    rp = 1.0 if family in ("cheby1", "ellip") else None
    rs = 40.0 if family in ("cheby2", "ellip") else None
    ours = design_iir(family=family, btype=btype, order=4, cutoff=cut, fs=FS, rp=rp, rs=rs)
    wn = cut if len(cut) == 2 else cut[0]
    ref = (
        signal.bessel(4, wn, btype=btype, output="sos", fs=FS)
        if family == "bessel"
        else signal.iirfilter(4, wn, rp=rp, rs=rs, btype=btype, ftype=family, output="sos", fs=FS)
    )
    np.testing.assert_array_equal(ours, ref)


def test_chebyshev1_gain_at_cutoff_is_exactly_minus_rp_and_ripple_is_bounded() -> None:
    # |H(wc)|^2 = 1/(1+eps^2), eps^2 = 10^(rp/10)-1  =>  -rp dB at the edge.
    rp = 0.5
    sos = design_iir(family="cheby1", btype="lowpass", order=5, cutoff=[15.0], fs=FS, rp=rp)
    assert 20 * np.log10(_gain_at(sos, 15.0)) == pytest.approx(-rp, abs=1e-6)
    f, h = signal.sosfreqz(sos, worN=2048, fs=FS)
    assert 20 * np.log10(np.abs(h[f <= 15.0])).min() >= -rp - 1e-6


def test_chebyshev2_gain_at_stopband_edge_is_minus_rs_and_stays_below() -> None:
    rs = 45.0
    sos = design_iir(family="cheby2", btype="lowpass", order=5, cutoff=[20.0], fs=FS, rs=rs)
    assert 20 * np.log10(_gain_at(sos, 20.0)) == pytest.approx(-rs, abs=1e-6)
    f, h = signal.sosfreqz(sos, worN=2048, fs=FS)
    assert 20 * np.log10(np.abs(h[f >= 20.0])).max() <= -rs + 1e-6


def test_elliptic_passband_edge_ripple_and_stopband_floor() -> None:
    rp, rs = 1.0, 50.0
    sos = design_iir(family="ellip", btype="lowpass", order=4, cutoff=[10.0], fs=FS, rp=rp, rs=rs)
    assert 20 * np.log10(_gain_at(sos, 10.0)) == pytest.approx(-rp, abs=1e-6)
    f, h = signal.sosfreqz(sos, worN=4096, fs=FS)
    db = 20 * np.log10(np.abs(h))
    assert db[f <= 10.0].min() >= -rp - 1e-6
    assert db[f >= 30.0].max() <= -rs + 1e-6


def test_bessel_mag_normalization_is_3_db_down_at_the_cutoff() -> None:
    sos = design_iir(
        family="bessel", btype="lowpass", order=4, cutoff=[5.0], fs=FS, bessel_norm="mag"
    )
    assert 20 * np.log10(_gain_at(sos, 5.0)) == pytest.approx(-3.0103, abs=0.05)


def test_causal_and_zero_phase_application_match_scipy() -> None:
    rng = np.random.default_rng(3)
    y = 5.0 + rng.normal(size=400)
    sos = design_iir(family="butter", btype="lowpass", order=4, cutoff=[10.0], fs=FS)
    np.testing.assert_allclose(apply_iir(sos, y, zero_phase=True), signal.sosfiltfilt(sos, y))
    ref = signal.sosfilt(sos, y, zi=signal.sosfilt_zi(sos) * y[0])[0]
    np.testing.assert_allclose(apply_iir(sos, y, zero_phase=False), ref)
    # steady-state start: a constant passes through a low-pass untouched (no startup ring)
    flat = apply_iir(sos, np.full(50, 7.0), zero_phase=False)
    np.testing.assert_allclose(flat, 7.0, atol=1e-9)


def test_zero_phase_has_no_delay_but_causal_does() -> None:
    t = np.arange(2000) / FS
    y = np.sin(2 * np.pi * 2.0 * t)
    sos = design_iir(family="butter", btype="lowpass", order=4, cutoff=[5.0], fs=FS)
    mid = slice(500, 1500)
    zp = apply_iir(sos, y, zero_phase=True)[mid]
    ca = apply_iir(sos, y, zero_phase=False)[mid]
    assert np.max(np.abs(zp - y[mid])) < 0.02
    assert np.max(np.abs(ca - y[mid])) > 0.1  # group delay lags the sine


def test_frequency_response_matches_sosfreqz_and_is_finite() -> None:
    sos = design_iir(
        family="ellip", btype="bandstop", order=3, cutoff=[10.0, 20.0], fs=FS, rp=1, rs=60
    )
    r = frequency_response(sos, FS, 256)
    f, h = signal.sosfreqz(sos, worN=256, fs=FS)
    np.testing.assert_allclose(r["frequency"], f)
    np.testing.assert_allclose(
        r["magnitudeDb"], np.maximum(20 * np.log10(np.abs(h)), -300.0), atol=1e-9
    )
    np.testing.assert_allclose(r["phaseDeg"], np.degrees(np.unwrap(np.angle(h))))
    assert np.all(np.isfinite(r["magnitudeDb"])) and np.all(np.isfinite(r["phaseDeg"]))


@pytest.mark.parametrize(
    "kwargs,match",
    [
        (dict(family="nope", btype="lowpass", order=2, cutoff=[5.0]), "family"),
        (dict(family="butter", btype="notch", order=2, cutoff=[5.0]), "band type"),
        (dict(family="butter", btype="lowpass", order=0, cutoff=[5.0]), "order"),
        (dict(family="butter", btype="lowpass", order=21, cutoff=[5.0]), "order"),
        (dict(family="butter", btype="lowpass", order=2.5, cutoff=[5.0]), "integer"),
        (dict(family="butter", btype="lowpass", order=2, cutoff=[50.0]), "Nyquist"),
        (dict(family="butter", btype="lowpass", order=2, cutoff=[0.0]), "positive"),
        (dict(family="butter", btype="lowpass", order=2, cutoff=[float("nan")]), "finite"),
        (dict(family="butter", btype="bandpass", order=2, cutoff=[5.0]), "2 cutoff"),
        (dict(family="butter", btype="bandpass", order=2, cutoff=[9.0, 5.0]), "lower cutoff"),
        (dict(family="cheby1", btype="lowpass", order=2, cutoff=[5.0]), "rp"),
        (dict(family="cheby2", btype="lowpass", order=2, cutoff=[5.0]), "rs"),
        (dict(family="ellip", btype="lowpass", order=2, cutoff=[5.0], rp=3, rs=2), "exceed"),
        (dict(family="butter", btype="lowpass", order=2, cutoff=[5.0], rp=1.0), "does not apply"),
        (
            dict(family="cheby1", btype="lowpass", order=2, cutoff=[5.0], rp=1.0, rs=20.0),
            "does not apply",
        ),
    ],
)
def test_bad_designs_are_refused_with_a_reason(kwargs: dict, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        design_iir(fs=FS, **kwargs)


def test_zero_phase_refuses_a_record_shorter_than_the_pad() -> None:
    sos = design_iir(family="butter", btype="lowpass", order=8, cutoff=[5.0], fs=FS)
    with pytest.raises(ValueError, match="more than"):
        apply_iir(sos, np.arange(10.0), zero_phase=True)


# --- workbench integration -------------------------------------------------


def _ds(x: np.ndarray | None = None) -> DataStruct:
    x = np.arange(600) / FS if x is None else x
    y = np.column_stack(
        [np.sin(2 * np.pi * 2 * x) + 0.5 * np.sin(2 * np.pi * 30 * x), np.cos(2 * np.pi * x)]
    )
    return DataStruct.create(
        x, y, labels=["a", "b"], units=["V", "V"], metadata={"xLabel": "Time", "xUnit": "s"}
    )


_SPEC = dict(
    family="cheby1",
    btype="lowpass",
    order=4,
    cutoff=[8.0],
    rp=0.5,
    bessel_norm="phase",
    zero_phase=True,
)


def test_workbench_iir_equals_direct_scipy_and_records_provenance() -> None:
    ds = _ds()
    out = spectral_workbench(
        ds, operation="filter", channels=[1, 0], iir=dict(_SPEC), include_diagnostics=True
    )
    sos = signal.iirfilter(4, 8.0, rp=0.5, btype="lowpass", ftype="cheby1", output="sos", fs=FS)
    np.testing.assert_allclose(
        out.values[:, 0], signal.sosfiltfilt(sos, ds.values[:, 1]), atol=1e-12
    )
    np.testing.assert_allclose(
        out.values[:, 1], signal.sosfiltfilt(sos, ds.values[:, 0]), atol=1e-12
    )
    assert out.labels == ("b · Filtered", "a · Filtered")
    params = out.metadata["spectralAnalysis"]["parameters"]
    assert params["engine"] == "iir" and params["zeroPhase"] is True
    assert params["samplingRate"] == pytest.approx(FS)
    resp = out.metadata["iirResponse"]
    assert resp["zeroPhase"] is True and set(resp["phaseDeg"]) == {0.0}
    assert len(resp["frequency"]) == len(resp["magnitudeDb"]) == 512


def test_workbench_iir_refuses_irregular_sampling_unless_resample_is_explicit() -> None:
    x = np.arange(600) / FS
    x = x + 0.004 * np.sin(np.linspace(0, 20, x.size))
    with pytest.raises(ValueError, match="not uniform"):
        spectral_workbench(_ds(x), operation="filter", channels=[0], iir=dict(_SPEC))
    out = spectral_workbench(
        _ds(x), operation="filter", channels=[0], iir=dict(_SPEC), resample=True
    )
    assert out.metadata["spectralAnalysis"]["resampled"] is True


def test_workbench_iir_only_applies_to_the_filter_operation_and_rejects_unknown_keys() -> None:
    with pytest.raises(ValueError, match="only to the filter"):
        spectral_workbench(_ds(), operation="fft", channels=[0], iir=dict(_SPEC))
    with pytest.raises(ValueError, match="unknown IIR"):
        spectral_workbench(_ds(), operation="filter", channels=[0], iir={**_SPEC, "extra": 1})


def test_workbench_without_iir_is_unchanged() -> None:
    out = spectral_workbench(_ds(), operation="filter", channels=[0], cutoff=[5.0])
    assert "engine" not in out.metadata["spectralAnalysis"]["parameters"]
