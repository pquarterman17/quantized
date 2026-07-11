"""Reductions (calc/reductions.py, PORT_PLAN #19): Williamson-Hall,
FFT thickness (Laue fringes), reflectivity FFT (Kiessig + superlattice),
neutron spin asymmetry.

Golden-verified against ``calc.crystal.williamsonHall`` /
``bosonPlotter.peakTools.{fftThickness,reflectivityFFT}`` / the
``computeAsymmetryForExport`` formula (``calc_reductions.json``; the FFT
cases call the real MATLAB dialog functions headless, so the frozen values
went through the exact GUI code path). Standalone reference-value tests
keep coverage without the frozen JSON.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.reductions import (
    fft_thickness,
    reflectivity_fft,
    spin_asymmetry,
    williamson_hall,
)

# ── freeze inputs (mirror redFreeze in tools/matlab/freeze_calc_values.m) ───

_TT4 = [30.1, 35.5, 43.2, 57.0]
_FW4 = [0.25, 0.26, 0.28, 0.32]
_LAM = 1.5406


def _laue_signal() -> tuple[np.ndarray, np.ndarray]:
    # Flat-ish envelope so fringes dominate (a strong film-peak envelope
    # buries the fringe under its own broad low-frequency FFT lobe).
    tt = np.linspace(15, 35, 601)
    q = (4 * math.pi / _LAM) * np.sin(np.deg2rad(tt / 2))
    intensity = 500 * (1 + 0.45 * np.cos(q * 800)) + 0.5 * tt + 50
    return tt, intensity


def _kiessig_q() -> np.ndarray:
    return np.linspace(0.01, 0.12, 351)


def _kiessig_signal(*components: tuple[float, float]) -> np.ndarray:
    """R(Q) = Q^-4 envelope x (1 + sum a_i cos(Q d_i)), normalized to max 1."""
    q = _kiessig_q()
    fringes = np.ones_like(q)
    for amp, d_angstrom in components:
        fringes = fringes + amp * np.cos(q * d_angstrom)
    r = np.maximum(q, 1e-3) ** -4.0 * fringes
    return np.asarray(r / r.max(), dtype=float)


def _xrr_signal() -> tuple[np.ndarray, np.ndarray]:
    tt = np.linspace(0.5, 6, 401)
    q = (4 * math.pi / _LAM) * np.sin(np.deg2rad(tt / 2))
    r = np.maximum(q, 1e-3) ** -4.0 * (1 + 0.4 * np.cos(q * 900))
    return tt, np.asarray(r / r.max(), dtype=float)


_RPP = [0.95, 0.80, 0.60, 0.40, 0.25, 0.10, 0.05, -0.01, float("nan"), 0.02]
_RMM = [0.90, 0.70, 0.45, 0.30, 0.15, 0.08, 0.06, 0.03, 0.01, float("nan")]


# ── golden parity ────────────────────────────────────────────────────────────


@pytest.mark.golden
def test_williamson_hall_golden(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    ref = load_golden("calc_reductions.json")

    basic = williamson_hall(_TT4, _FW4)
    exp = ref["wh_basic"]["output"]
    compare_calc(basic["grain_size_nm"], exp["grainSize_nm"])
    compare_calc(basic["microstrain"], exp["microstrain"])
    compare_calc(basic["r2"], exp["R2"])
    compare_calc(basic["plot_x"], exp["plotData"]["x"])
    compare_calc(basic["plot_y"], exp["plotData"]["y"])
    compare_calc(basic["fit_line"], exp["plotData"]["fitLine"])

    inst = williamson_hall(
        _TT4, _FW4, wavelength_a=1.5406, k_factor=0.94, instrumental_broadening_deg=0.08
    )
    exp = ref["wh_instrument"]["output"]
    compare_calc(inst["grain_size_nm"], exp["grainSize_nm"])
    compare_calc(inst["microstrain"], exp["microstrain"])
    compare_calc(inst["r2"], exp["R2"])


@pytest.mark.golden
def test_fft_thickness_golden(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    ref = load_golden("calc_reductions.json")["fft_thickness"]
    tt, intensity = _laue_signal()
    got = fft_thickness(tt, intensity, _LAM, two_theta_min=15, two_theta_max=35)
    exp = ref["output"]
    compare_calc(got["thickness_nm"], exp["thickness_nm"])
    compare_calc(got["uncertainty_nm"], exp["uncertainty_nm"])
    compare_calc(got["two_theta_range"], exp["twoTheta_range"])
    # atol 1e-8: near-cancellation FFT bins (magnitude ~0.1 in a spectrum
    # peaking ~4e3) differ between MATLAB fft and numpy at ~1e-10 absolute.
    compare_calc(got["fft_magnitude"], exp["fft_magnitude"], atol=1e-8)
    compare_calc(got["thickness_axis"], exp["thickness_axis"])


_REFL_GOLDEN_CASES = [
    ("refl_neutron_single", [(0.4, 1200.0)]),
    ("refl_neutron_superlattice", [(0.35, 300.0), (0.25, 600.0), (0.18, 900.0)]),
    ("refl_neutron_suppressed", [(0.35, 300.0), (0.20, 900.0), (0.15, 1200.0)]),
]


@pytest.mark.golden
@pytest.mark.parametrize(("case", "components"), _REFL_GOLDEN_CASES)
def test_reflectivity_fft_neutron_golden(
    case: str,
    components: list[tuple[float, float]],
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    ref = load_golden("calc_reductions.json")[case]["output"]
    got = reflectivity_fft(
        _kiessig_q(), _kiessig_signal(*components), is_neutron=True, x_min=0.01, x_max=0.12
    )
    compare_calc(got["thicknesses_nm"], ref["thicknesses_nm"])
    compare_calc(got["amplitudes"], ref["amplitudes"], atol=1e-8)
    assert got["harmonic_labels"] == list(ref["harmonicLabels"])
    compare_calc(got["q_range"], ref["Q_range"])
    compare_calc(got["fft_magnitude"], ref["fft_magnitude"], atol=1e-8)
    sl = got["superlattice"]
    sl_exp = ref["superlattice"]
    assert sl["detected"] == bool(sl_exp["detected"])
    compare_calc(sl["bilayer_period_nm"], sl_exp["bilayerPeriod_nm"])
    compare_calc(sl["total_thickness_nm"], sl_exp["totalThickness_nm"])
    compare_calc(sl["n_repeats"], sl_exp["nRepeats"])
    compare_calc(sl["sublayer_a_nm"], sl_exp["sublayerA_nm"])
    compare_calc(sl["sublayer_b_nm"], sl_exp["sublayerB_nm"])
    assert sl["suppressed_orders"] == list(np.atleast_1d(sl_exp["suppressedOrders"] or []))


@pytest.mark.golden
def test_reflectivity_fft_xrr_golden(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    ref = load_golden("calc_reductions.json")["refl_xrr_single"]["output"]
    tt, r = _xrr_signal()
    got = reflectivity_fft(tt, r, wavelength_a=_LAM, x_min=0.5, x_max=6)
    compare_calc(got["thicknesses_nm"], ref["thicknesses_nm"])
    compare_calc(got["q_range"], ref["Q_range"])
    compare_calc(got["fft_magnitude"], ref["fft_magnitude"], atol=1e-8)
    assert got["wavelength_a"] == pytest.approx(ref["wavelength_A"])


@pytest.mark.golden
def test_spin_asymmetry_golden(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    ref = load_golden("calc_reductions.json")["spin_asymmetry"]["output"]
    got = spin_asymmetry(_RPP, _RMM, [0.02] * 10, [0.015] * 10)
    compare_calc(got["asymmetry"], ref["asymmetry"])
    compare_calc(got["d_asymmetry"], ref["dAsymmetry"])
    assert got["n_valid"] == ref["nValid"]


# ── standalone reference-value tests (no golden needed) ─────────────────────


def test_wh_recovers_known_size_and_strain() -> None:
    # Synthesize peak widths from a known D and eps, then invert.
    d_a, eps, lam, k = 450.0, 2.0e-3, 1.5406, 0.9
    tt = np.array([28.0, 40.0, 55.0, 70.0])
    theta = np.deg2rad(tt / 2)
    beta = k * lam / d_a / np.cos(theta) + 4 * eps * np.sin(theta) / np.cos(theta)
    r = williamson_hall(tt, np.rad2deg(beta), wavelength_a=lam, k_factor=k)
    assert r["grain_size_nm"] == pytest.approx(d_a / 10, rel=1e-9)
    assert r["microstrain"] == pytest.approx(eps, rel=1e-9)
    assert r["r2"] == pytest.approx(1.0, abs=1e-12)


def test_wh_negative_intercept_gives_nan_size() -> None:
    # Widths increasing steeply enough that the fitted line crosses y < 0
    # at x = 0 (slope > y1/x1) -> intercept < 0 -> grain size undefined.
    r = williamson_hall([20.0, 140.0], [0.05, 2.0])
    assert math.isnan(r["grain_size_nm"])
    assert math.isfinite(r["microstrain"])


def test_wh_validation() -> None:
    with pytest.raises(ValueError, match="same length"):
        williamson_hall([30.0, 40.0], [0.2])
    with pytest.raises(ValueError, match="at least 2"):
        williamson_hall([30.0], [0.2])
    with pytest.raises(ValueError, match="range"):
        williamson_hall([30.0, 190.0], [0.2, 0.2])
    with pytest.raises(ValueError, match="FWHM"):
        williamson_hall([30.0, 40.0], [0.2, -0.1])


def test_fft_thickness_recovers_fringe_period() -> None:
    tt, intensity = _laue_signal()  # 800 A = 80 nm fringes
    r = fft_thickness(tt, intensity, _LAM)
    assert r["thickness_nm"] == pytest.approx(80.0, abs=2.0)
    assert r["uncertainty_nm"] < 20


@pytest.mark.parametrize("window", ["hann", "blackman", "none"])
def test_fft_thickness_windows_agree_on_period(window: str) -> None:
    tt, intensity = _laue_signal()
    r = fft_thickness(tt, intensity, _LAM, window=window)
    assert r["thickness_nm"] == pytest.approx(80.0, abs=3.0)


def test_fft_thickness_too_few_points() -> None:
    with pytest.raises(ValueError, match=">= 10"):
        fft_thickness([20, 21, 22], [1, 2, 1], _LAM)
    with pytest.raises(ValueError, match="less than"):
        fft_thickness(*_laue_signal(), _LAM, two_theta_min=30, two_theta_max=20)
    with pytest.raises(ValueError, match="window"):
        fft_thickness(*_laue_signal(), _LAM, window="hamming")


def test_reflectivity_fft_neutron_finds_120nm() -> None:
    r = reflectivity_fft(_kiessig_q(), _kiessig_signal((0.4, 1200.0)), is_neutron=True)
    assert r["thicknesses_nm"][0] == pytest.approx(120.0, abs=3.0)
    assert not r["superlattice"]["detected"]
    assert "wavelength_a" not in r


def test_reflectivity_fft_superlattice_detection() -> None:
    r = reflectivity_fft(
        _kiessig_q(),
        _kiessig_signal((0.35, 300.0), (0.25, 600.0), (0.18, 900.0)),
        is_neutron=True,
    )
    sl = r["superlattice"]
    assert sl["detected"]
    assert sl["bilayer_period_nm"] == pytest.approx(30.0, abs=1.5)
    assert "Bilayer Λ" in r["harmonic_labels"]
    assert any(label.startswith("SL order") for label in r["harmonic_labels"])


def test_reflectivity_fft_suppressed_order_sublayers() -> None:
    # Orders 1, 3, 4 present; order 2 missing -> equal sublayers Lambda/2.
    # Uses linear R preprocessing on a flat envelope: with the default
    # log(R) the log of the fringe product regenerates order 2 as a
    # cross-term (90-30 = 60 nm) and nothing is suppressed — that variant
    # is locked by the refl_neutron_suppressed golden instead.
    q = _kiessig_q()
    r_flat = (
        1.0 + 0.35 * np.cos(q * 300.0) + 0.20 * np.cos(q * 900.0) + 0.15 * np.cos(q * 1200.0)
    )
    r = reflectivity_fft(q, r_flat, is_neutron=True, preprocess="R")
    sl = r["superlattice"]
    assert sl["detected"]
    assert 2 in sl["suppressed_orders"]
    assert sl["sublayer_a_nm"] == pytest.approx(sl["bilayer_period_nm"] / 2, rel=1e-9)


def test_reflectivity_fft_xrr_requires_wavelength() -> None:
    tt, r = _xrr_signal()
    with pytest.raises(ValueError, match="wavelength"):
        reflectivity_fft(tt, r)


def test_reflectivity_fft_preprocess_modes_all_run() -> None:
    q, r = _kiessig_q(), _kiessig_signal((0.4, 1200.0))
    for mode in ("logR", "logRQ4", "R", "RQ4"):
        out = reflectivity_fft(q, r, is_neutron=True, preprocess=mode)
        assert out["preprocess"] == mode
        assert len(out["thicknesses_nm"]) >= 1
    with pytest.raises(ValueError, match="preprocess"):
        reflectivity_fft(q, r, is_neutron=True, preprocess="sqrt")


def test_spin_asymmetry_formula_and_mask() -> None:
    got = spin_asymmetry([0.9, 0.5, -0.1], [0.3, 0.5, 0.2], [0.01, 0.01, 0.01], None)
    asym = got["asymmetry"]
    assert asym[0] == pytest.approx((0.9 - 0.3) / 1.2)
    assert asym[1] == pytest.approx(0.0)
    assert math.isnan(asym[2])  # non-positive channel -> masked
    assert got["n_valid"] == 2
    # error propagation: dA/dR++ = 2 R-- / sum^2 with dR-- = 0
    expected_err = 2 * 0.3 / 1.2**2 * 0.01
    assert got["d_asymmetry"][0] == pytest.approx(expected_err)


def test_spin_asymmetry_length_mismatch() -> None:
    with pytest.raises(ValueError, match="one Q grid"):
        spin_asymmetry([0.9, 0.5], [0.3])
