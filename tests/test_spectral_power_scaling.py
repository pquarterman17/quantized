"""PSD power ("spectrum") scaling versus scipy, and the workbench labels/units."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import signal

from quantized.calc.spectral import _make_window, fft_spectral
from quantized.calc.spectral_workbench import spectral_workbench
from quantized.datastruct import DataStruct

N = 256
FS = 100.0
X = np.arange(N) / FS
RNG = np.random.default_rng(7)
Y = 3.0 * np.sin(2 * np.pi * 12.5 * X) + 0.5 * RNG.standard_normal(N) + 2.0


@pytest.mark.parametrize("window", ["hanning", "hamming", "blackman", "none"])
@pytest.mark.parametrize("scaling", ["density", "spectrum"])
@pytest.mark.parametrize("sided", ["one", "two"])
def test_single_record_matches_scipy_periodogram(window: str, scaling: str, sided: str) -> None:
    out = fft_spectral(X, Y, window=window, output_type="psd", sided=sided, scaling=scaling,
                       zero_pad=N)
    win = _make_window(window, N, 5.0)
    freq, ref = signal.periodogram(Y, FS, window=win, nfft=N, detrend="constant",
                                   return_onesided=(sided == "one"), scaling=scaling)
    got = np.asarray(out["psd"])
    if sided == "two":
        ref = np.fft.fftshift(ref)
    np.testing.assert_allclose(got, ref, rtol=1e-9, atol=1e-12)
    if sided == "one":
        np.testing.assert_allclose(out["freq"], freq)


@pytest.mark.parametrize("scaling", ["density", "spectrum"])
@pytest.mark.parametrize("sided", ["one", "two"])
def test_welch_matches_scipy(scaling: str, sided: str) -> None:
    seg, overlap = 64, 0.5
    out = fft_spectral(X, Y, window="hamming", output_type="psd", sided=sided,
                       scaling=scaling, segment_len=seg, overlap=overlap)
    win = _make_window("hamming", seg, 5.0)
    _, ref = signal.welch(Y, FS, window=win, nperseg=seg, noverlap=seg // 2, nfft=seg,
                          detrend="constant", return_onesided=(sided == "one"), scaling=scaling)
    if sided == "two":
        ref = np.fft.fftshift(ref)
    np.testing.assert_allclose(out["psd"], ref, rtol=1e-9, atol=1e-12)


def test_default_is_density_and_unknown_scaling_is_refused() -> None:
    a = fft_spectral(X, Y, output_type="psd")["psd"]
    b = fft_spectral(X, Y, output_type="psd", scaling="density")["psd"]
    np.testing.assert_array_equal(a, b)
    with pytest.raises(ValueError, match="scaling"):
        fft_spectral(X, Y, output_type="psd", scaling="rms")


def test_power_scaling_reads_mean_square_power_of_a_sinusoid() -> None:
    # A bin-centred sine of amplitude A has mean-square power A^2/2 in one bin.
    n = 200
    x = np.arange(n) / FS
    y = 3.0 * np.sin(2 * np.pi * 10.0 * x)  # 20 whole cycles
    out = fft_spectral(x, y, window="none", output_type="psd", scaling="spectrum", zero_pad=n)
    assert np.max(out["psd"]) == pytest.approx(4.5, rel=1e-9)


def _ds() -> DataStruct:
    return DataStruct.create(
        X, np.column_stack([Y]), labels=["signal"], units=["V"],
        metadata={"xLabel": "Time", "xUnit": "s"},
    )


def test_workbench_labels_units_and_provenance_change_with_scaling() -> None:
    kw = {"operation": "fft", "channels": [0], "output_type": "psd", "window": "none"}
    dens = spectral_workbench(_ds(), **kw)  # type: ignore[arg-type]
    powr = spectral_workbench(_ds(), psd_scaling="spectrum", **kw)  # type: ignore[arg-type]
    assert tuple(dens.labels) == ("signal · PSD",) and tuple(dens.units) == ("V²·s",)
    assert tuple(powr.labels) == ("signal · Power",) and tuple(powr.units) == ("V²",)
    assert "psdScaling" not in dens.metadata["spectralAnalysis"]["parameters"]
    assert powr.metadata["spectralAnalysis"]["parameters"]["psdScaling"] == "spectrum"
    # Same shape; power = density * fs * sum(w^2) / sum(w)^2 (here a rectangular window).
    np.testing.assert_allclose(powr.values[:, 0], dens.values[:, 0] * FS / N, rtol=1e-9)


def test_workbench_refuses_power_scaling_for_non_psd_output() -> None:
    with pytest.raises(ValueError, match="PSD output"):
        spectral_workbench(_ds(), operation="fft", channels=[0], output_type="magnitude",
                           psd_scaling="spectrum")
    with pytest.raises(ValueError, match="scaling"):
        spectral_workbench(_ds(), operation="fft", channels=[0], output_type="psd", window="none",
                           psd_scaling="bogus")
