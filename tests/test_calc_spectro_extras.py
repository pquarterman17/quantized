"""G21 spectroscopy extras: Fourier self-deconvolution, Noda 2-D correlation, peak onset.

Oracles are independent of the implementation: the analytic sinc^2 line shape
of the triangular apodization (FSD), a double-loop transcription of Noda's
published definition with the Hilbert-Noda matrix N_jk = 1/(pi (k - j)) (2-D
correlation), and the analytic piecewise-linear / erf edges (onset).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.integrate import quad
from scipy.optimize import brentq
from scipy.special import erf, erfinv

from quantized.calc.spectro_corr2d import correlation_2d, correlation_maps, hilbert_noda_matrix
from quantized.calc.spectro_fsd import apodization_fwhm, fourier_self_deconvolution
from quantized.calc.spectro_onset import peak_onset

# ---------------------------------------------------------------- FSD


def _lorentz(x: np.ndarray, x0: float, hwhm: float, area: float) -> np.ndarray:
    return area * (hwhm / math.pi) / ((x - x0) ** 2 + hwhm**2)


def test_triangular_width_matches_analytic_sinc_squared() -> None:
    # line shape of A(t) = 1 - |t| (|t| < 1) is sinc^2(x); half height at the root of sinc^2 = 1/2
    half = brentq(lambda v: np.sinc(v) ** 2 - 0.5, 0.01, 0.9)
    assert apodization_fwhm("triangular") == pytest.approx(2 * half, rel=1e-6)


def test_bessel_width_matches_quad() -> None:
    def shape(v: float) -> float:
        return 2 * quad(lambda t: (1 - t * t) ** 2 * math.cos(2 * math.pi * v * t), 0, 1)[0]

    half = brentq(lambda v: shape(v) - 0.5 * shape(0), 0.01, 1.0)
    assert apodization_fwhm("bessel") == pytest.approx(2 * half, rel=1e-6)


def test_fsd_sum_of_lorentzians_narrows_in_place_and_conserves_area() -> None:
    x = np.arange(0, 1000.5, 0.5)
    hw, k = 2.0, 2.0
    peaks = [(300.0, 1.0), (310.0, 0.6), (600.0, 2.0)]
    y = sum(_lorentz(x, x0, hw, a) for x0, a in peaks)
    out, info = fourier_self_deconvolution(x, y, hw, k, "triangular")
    # independent direct computation: each Lorentzian becomes area * L sinc^2(L (x - x0))
    big_l = info["cutoff"]
    direct = sum(a * big_l * np.sinc(big_l * (x - x0)) ** 2 for x0, a in peaks)
    assert np.max(np.abs(out - direct)) < 2e-3 * np.max(direct)
    # same positions, narrower, area conserved
    assert x[np.argmax(out[(x > 590) & (x < 610)]) + np.flatnonzero(x > 590)[0]] == pytest.approx(
        600.0, abs=0.5
    )
    sel = (x > 560) & (x < 640)
    xs, ys = x[sel], out[sel]
    ip = int(np.argmax(ys))
    half = ys[ip] / 2
    lo = ip
    while ys[lo] > half:
        lo -= 1
    hi = ip
    while ys[hi] > half:
        hi += 1
    left = xs[lo] + (half - ys[lo]) / (ys[lo + 1] - ys[lo]) * (xs[lo + 1] - xs[lo])
    right = xs[hi - 1] + (ys[hi - 1] - half) / (ys[hi - 1] - ys[hi]) * (xs[hi] - xs[hi - 1])
    fwhm = right - left
    assert fwhm == pytest.approx(2 * hw / k, rel=0.02)  # FWHM 2 hwhm / K = 2
    assert fwhm < 2 * hw  # narrower than the input FWHM (4)
    assert out.sum() * 0.5 == pytest.approx(y.sum() * 0.5, rel=2e-3)
    assert info["fwhm_out"] == pytest.approx(2.0)


def test_fsd_refusals() -> None:
    x = np.arange(0, 100, 0.5)
    y = _lorentz(x, 50, 2.0, 1.0)
    with pytest.raises(ValueError, match="uniform"):
        xu = x.copy()
        xu[10] += 0.2
        fourier_self_deconvolution(xu, y, 2.0, 2.0)
    with pytest.raises(ValueError, match="too large"):
        fourier_self_deconvolution(x, y, 2.0, 50.0)
    with pytest.raises(ValueError, match="at least 1"):
        fourier_self_deconvolution(x, y, 2.0, 0.5)
    with pytest.raises(ValueError, match="smaller than one X step"):
        fourier_self_deconvolution(x, y, 0.1, 2.0)
    yb = y.copy()
    yb[3] = np.nan
    with pytest.raises(ValueError, match="finite"):
        fourier_self_deconvolution(x, yb, 2.0, 2.0)
    with pytest.raises(ValueError, match="apodization"):
        fourier_self_deconvolution(x, y, 2.0, 2.0, "boxcar")  # type: ignore[arg-type]


def test_fsd_reversed_axis_matches_forward() -> None:
    x = np.arange(0, 400, 0.5)
    y = _lorentz(x, 200, 2.0, 1.0)
    a, _ = fourier_self_deconvolution(x, y, 2.0, 2.0)
    b, _ = fourier_self_deconvolution(x[::-1], y[::-1], 2.0, 2.0)
    assert np.allclose(a, b[::-1], atol=1e-12)


# ---------------------------------------------------------------- 2-D correlation


def _noda_direct(spectra: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Noda's definition, transcribed with explicit loops."""
    m, n = spectra.shape
    dyn = spectra - spectra.mean(axis=0)
    phi = np.zeros((n, n))
    psi = np.zeros((n, n))
    for a in range(n):
        for b in range(n):
            phi[a, b] = sum(dyn[j, a] * dyn[j, b] for j in range(m)) / (m - 1)
            tot = 0.0
            for j in range(m):
                hn = sum(0.0 if j == kk else dyn[kk, b] / (math.pi * (kk - j)) for kk in range(m))
                tot += dyn[j, a] * hn
            psi[a, b] = tot / (m - 1)
    return phi, psi


def test_hilbert_noda_matrix_definition_and_antisymmetry() -> None:
    n = hilbert_noda_matrix(5)
    assert n[1, 3] == pytest.approx(1 / (math.pi * 2))
    assert n[3, 1] == pytest.approx(-1 / (math.pi * 2))
    assert np.all(np.diag(n) == 0)
    assert np.allclose(n, -n.T)


def test_matrices_match_direct_definition() -> None:
    rng = np.random.default_rng(3)
    spectra = rng.normal(size=(7, 6))
    r = correlation_2d(np.arange(6.0), spectra)
    phi, psi = _noda_direct(spectra)
    assert np.allclose(r["synchronous"], phi, atol=1e-13)
    assert np.allclose(r["asynchronous"], psi, atol=1e-13)


def _bands(c1: np.ndarray, c2: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x = np.linspace(0, 10, 101)
    b1 = np.exp(-((x - 3) ** 2) / 0.1)
    b2 = np.exp(-((x - 7) ** 2) / 0.1)
    return x, np.outer(c1, b1) + np.outer(c2, b2) + 0.5


def test_in_phase_bands_have_zero_asynchronous_between_them() -> None:
    t = np.arange(10.0)
    x, s = _bands(1 + 0.3 * t, 2 + 0.6 * t)  # both rise proportionally
    r = correlation_2d(x, s)
    i, j = int(np.argmin(abs(x - 3))), int(np.argmin(abs(x - 7)))
    assert abs(r["asynchronous"][i, j]) < 1e-12 * abs(r["synchronous"][i, j])
    assert r["synchronous"][i, j] > 0


def test_sequential_bands_follow_noda_sign_rule() -> None:
    t = np.arange(12.0)
    early = 1 / (1 + np.exp(-(t - 3)))  # band 1 changes first
    late = 1 / (1 + np.exp(-(t - 8)))  # band 2 changes later
    x, s = _bands(early, late)
    r = correlation_2d(x, s)
    i, j = int(np.argmin(abs(x - 3))), int(np.argmin(abs(x - 7)))
    phi, psi = r["synchronous"], r["asynchronous"]
    assert phi[i, j] > 0
    assert phi[i, j] * psi[i, j] > 0  # v1 changes before v2
    assert phi[j, i] * psi[j, i] < 0  # transposed pair: v2 after v1
    # one band falling: Phi < 0 and Psi is exactly the negative of the rising case
    x, s2 = _bands(early, 1 - late)
    r2 = correlation_2d(x, s2)
    assert r2["synchronous"][i, j] < 0
    assert r2["asynchronous"][i, j] == pytest.approx(-psi[i, j], rel=1e-9)


def test_axis_sorted_and_maps_are_native_grids() -> None:
    t = np.arange(6.0)
    x, s = _bands(t, t**2)
    sync, asyn, info = correlation_maps(x[::-1], s[:, ::-1], x_label="Wavenumber", x_unit="cm-1")
    assert sync.metadata["map_shape"] == [101, 101] and sync.metadata["map_grid"] == "native"
    assert asyn.metadata["corr2d"]["kind"] == "asynchronous"
    assert info["x"][0] < info["x"][-1]
    ref = correlation_2d(x, s)
    assert np.allclose(sync.values[:, 2].reshape(101, 101), ref["synchronous"])


def test_correlation_refusals() -> None:
    x = np.arange(5.0)
    with pytest.raises(ValueError, match="at least 3"):
        correlation_2d(x, np.ones((2, 5)))
    s = np.random.default_rng(0).normal(size=(4, 5))
    with pytest.raises(ValueError, match="equally spaced"):
        correlation_2d(x, s, [0, 1, 3, 4])
    with pytest.raises(ValueError, match="strictly"):
        correlation_2d(x, s, [0, 1, 1, 2])
    s[1, 1] = np.nan
    with pytest.raises(ValueError, match="finite"):
        correlation_2d(x, s)
    assert (
        correlation_2d(x, np.random.default_rng(1).normal(size=(4, 5)), [10, 20, 30, 40])["m"] == 4
    )


# ---------------------------------------------------------------- onset


def _ramp(x: np.ndarray) -> np.ndarray:
    return np.clip(x - 2.0, 0, 2.0) * 3.0  # 0 until 2, slope 3 to 4, plateau 6


def test_piecewise_linear_edge_exact() -> None:
    x = np.arange(0, 10.0001, 0.05)
    r = peak_onset(x, _ramp(x), fraction=0.25)
    assert r["tangent"]["x_onset"] == pytest.approx(2.0, abs=1e-9)
    assert r["tangent"]["slope"] == pytest.approx(3.0)
    assert r["threshold"]["x_onset"] == pytest.approx(2.0 + 0.25 * 2.0, abs=1e-9)


def test_piecewise_linear_with_sloped_baseline_and_reversed_axis() -> None:
    x = np.arange(0, 10.0001, 0.05)
    y = _ramp(x) + 0.2 * x + 1.0
    r = peak_onset(x[::-1], y[::-1], fraction=0.5)
    assert r["tangent"]["x_onset"] == pytest.approx(2.0, abs=1e-9)
    assert r["threshold"]["x_onset"] == pytest.approx(3.0, abs=1e-9)


def test_erf_edge_analytic() -> None:
    x = np.arange(-20, 20.0001, 0.01)
    x0, w, amp = 1.5, 0.8, 4.0
    y = amp * (1 + erf((x - x0) / w)) / 2
    r = peak_onset(x, y, fraction=0.1)
    # steepest slope at x0 is amp / (w sqrt(pi)); the tangent meets the 0 baseline
    # at x0 - w sqrt(pi) / 2
    assert r["tangent"]["x_onset"] == pytest.approx(x0 - w * math.sqrt(math.pi) / 2, abs=2e-3)
    assert r["tangent"]["slope"] == pytest.approx(amp / (w * math.sqrt(math.pi)), rel=1e-4)
    assert r["threshold"]["x_onset"] == pytest.approx(x0 + w * erfinv(2 * 0.1 - 1), abs=2e-3)


def test_falling_edge_with_baseline_on_the_right() -> None:
    x = np.arange(-20, 20.0001, 0.01)
    y = 4.0 * (1 - erf((x - 1.5) / 0.8)) / 2
    r = peak_onset(x, y, side="right", fraction=0.1)
    assert r["tangent"]["x_onset"] == pytest.approx(1.5 + 0.8 * math.sqrt(math.pi) / 2, abs=2e-3)
    assert r["threshold"]["x_onset"] == pytest.approx(1.5 - 0.8 * erfinv(2 * 0.1 - 1), abs=2e-3)


def test_triangle_peak_leading_edge_and_smoothing() -> None:
    x = np.arange(0, 10.0001, 0.05)
    y = np.clip(np.minimum((x - 3) * 2, (7 - x) * 2), 0, None)
    r = peak_onset(x, y, fraction=0.5)
    assert r["tangent"]["x_onset"] == pytest.approx(3.0, abs=1e-9)
    assert r["top"]["x"] == pytest.approx(5.0, abs=0.05)
    assert r["threshold"]["x_onset"] == pytest.approx(4.0, abs=1e-9)


def test_smoothing_recovers_the_noiseless_erf_onset() -> None:
    x = np.arange(-20, 20.0001, 0.05)
    x0, w, amp = 1.5, 0.8, 4.0
    clean = amp * (1 + erf((x - x0) / w)) / 2
    noisy = clean + np.random.default_rng(5).normal(0, 0.01, x.size)
    rs = peak_onset(x, noisy, smooth=21)
    assert rs["tangent"]["x_onset"] == pytest.approx(x0 - w * math.sqrt(math.pi) / 2, abs=0.05)


def test_onset_refusals() -> None:
    x = np.arange(0, 10.0, 0.1)
    y = _ramp(x)
    with pytest.raises(ValueError, match="fraction"):
        peak_onset(x, y, fraction=1.5)
    with pytest.raises(ValueError, match="monotonic"):
        peak_onset(np.r_[x[:5], x[3], x[6:]], y)
    with pytest.raises(ValueError, match="fewer than 3"):
        peak_onset(x, y, baseline=(50, 60))
    with pytest.raises(ValueError, match="never leaves"):
        peak_onset(x, np.zeros_like(x))
    with pytest.raises(ValueError, match="odd"):
        peak_onset(x, y, smooth=4)
    yb = y.copy()
    yb[2] = np.inf
    with pytest.raises(ValueError, match="finite"):
        peak_onset(x, yb)
