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
