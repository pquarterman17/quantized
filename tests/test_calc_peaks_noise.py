"""Peak finding on noisy data: no noise peaks, true peaks found.

Fitting audit finding 11: on a clean 3-peak pattern with sigma = 5 noise the
detector returned 15 peaks at SNR >= 3 and 9 at the default 5, because SNIP's
background follows the BOTTOM of the noise: heights measured from it put every
noise maximum ~5 sigma "up" and gave it enough samples above half maximum to
pass the width test. Heights are now measured from the centre of the noise
band (a clipped median of the residual) and sigma comes from the MAD of the
second differences.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.peak_noise import estimate_noise
from quantized.calc.peaks import find_peaks_robust


def _gauss(x: np.ndarray, a: float, c: float, fwhm: float) -> np.ndarray:
    s = fwhm / (2 * np.sqrt(2 * np.log(2)))
    return a * np.exp(-((x - c) ** 2) / (2 * s * s))


def _lorentz(x: np.ndarray, a: float, c: float, fwhm: float) -> np.ndarray:
    return a / (1 + ((x - c) / (fwhm / 2)) ** 2)


def _pattern(seed: int, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    """The audit's pattern: 3 peaks on a sloping background, 2001 points."""
    rng = np.random.default_rng(seed)
    x = np.linspace(20, 60, 2001)
    y = (100 + 1.5 * (x - 20) + _gauss(x, 500, 30, 0.4) + _gauss(x, 300, 32, 0.4)
         + _lorentz(x, 800, 45, 0.6) + rng.normal(0, sigma, x.size))
    return x, y


@pytest.mark.parametrize("seed", [42, 0, 1, 2, 3])
@pytest.mark.parametrize(("snr", "sensitivity"), [(3.0, "medium"), (5.0, "medium"),
                                                  (5.0, "high"), (10.0, "medium")])
def test_three_true_peaks_and_no_noise_peaks(seed: int, snr: float, sensitivity: str) -> None:
    x, y = _pattern(seed, 5.0)
    peaks, _ = find_peaks_robust(x, y, snr_threshold=snr, sensitivity=sensitivity)
    assert [round(p["center"]) for p in peaks] == [30, 32, 45]


def test_heights_and_snr_are_measured_from_the_noise_centre() -> None:
    x, y = _pattern(42, 5.0)
    peaks, bg = find_peaks_robust(x, y)
    heights = [p["height"] for p in peaks]
    # Within a few sigma of the true amplitudes (they used to sit ~2 sigma
    # high: the residual was measured from the bottom of the noise band).
    np.testing.assert_allclose(heights, [500, 300, 800], atol=4 * 5.0)
    snr = [p["localSNR"] for p in peaks]
    np.testing.assert_allclose(snr, np.array(heights) / 5.0, rtol=0.1)
    # The returned background runs through the noise band (to within the
    # SNIP estimate's own local wiggle), not along its bottom (~2 sigma low).
    far = (x < 27) | (x > 52)
    assert abs(float(np.median((y - bg)[far]))) < 0.5 * 5.0


@pytest.mark.parametrize("sigma", [0.5, 5.0, 20.0])
def test_noise_estimate_tracks_true_sigma_on_a_sloped_peaky_pattern(sigma: float) -> None:
    x, y = _pattern(7, sigma)
    assert estimate_noise(y) == pytest.approx(sigma, rel=0.1)


def test_a_weak_real_peak_is_still_found() -> None:
    rng = np.random.default_rng(5)
    x = np.linspace(0, 40, 2001)
    y = 50 + _gauss(x, 400, 12, 0.5) + _gauss(x, 45, 28, 0.6) + rng.normal(0, 3, x.size)
    peaks, _ = find_peaks_robust(x, y, snr_threshold=5.0)
    assert [round(p["center"]) for p in peaks] == [12, 28]  # the 15-sigma peak survives


def test_pure_noise_has_no_peaks() -> None:
    rng = np.random.default_rng(9)
    x = np.linspace(0, 10, 3000)
    peaks, _ = find_peaks_robust(x, 200 + rng.normal(0, 4, x.size), snr_threshold=3.0)
    assert peaks == []


# ── review item 7: integer counts tie on the smoothed maximum ──────────────


def test_matched_filter_keeps_a_flat_topped_peak() -> None:
    from quantized.calc.peak_noise import matched_filter_keep

    resid = np.zeros(60)
    resid[28:32] = [20.0, 60.0, 60.0, 20.0]  # ties -> the 5-point mean has a 2-sample plateau
    resid[10] = 4.0
    keep = matched_filter_keep(resid, np.array([29, 10]), 1.0, 5, 5.0)
    assert keep.tolist() == [True, False]


@pytest.mark.parametrize("seed", range(6))
def test_poisson_peak_with_tied_integer_counts_is_found(seed: int) -> None:
    rng = np.random.default_rng(seed)
    x = np.linspace(0.0, 20.0, 801)
    y = rng.poisson(8 + _gauss(x, 60, 10.0, 0.5)).astype(float)
    peaks, _ = find_peaks_robust(x, y)
    assert [round(p["center"]) for p in peaks] == [10]


# ── review item 8: correlated (non-white) noise ─────────────────────────────


def _correlated(seed: int, k: int, n: int = 4000, sigma: float = 3.3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    white = rng.normal(0, 1, n + k)
    ma = np.convolve(white, np.ones(k) / k, mode="valid")[:n]
    return np.asarray(ma / np.std(ma) * sigma, dtype=float)


@pytest.mark.parametrize("k", [5, 11, 21])
def test_noise_estimate_handles_correlated_noise(k: int) -> None:
    for seed in range(3):
        noise = _correlated(seed, k)
        # The white-noise estimator read 0.63 for sigma = 3.3 at k = 21.
        assert estimate_noise(100 + noise) == pytest.approx(3.3, rel=0.25)


@pytest.mark.parametrize("k", [5, 11, 21])
def test_correlated_noise_gives_no_flood_of_false_peaks(k: int) -> None:
    x = np.linspace(20.0, 60.0, 4000)
    found = 0
    for seed in range(3):
        y = 100 + 1.5 * (x - 20) + _correlated(seed, k) + _gauss(x, 300, 40.0, 0.4)
        peaks, _ = find_peaks_robust(x, y)
        centers = [p["center"] for p in peaks]
        assert any(abs(c - 40.0) < 0.1 for c in centers)
        found += len(centers) - 1
    assert found <= 1  # was 18-37 false peaks per pattern


def test_white_noise_estimate_is_not_inflated_by_the_multi_lag_estimate() -> None:
    rng = np.random.default_rng(3)
    assert estimate_noise(50 + rng.normal(0, 2.0, 5000)) == pytest.approx(2.0, rel=0.05)
