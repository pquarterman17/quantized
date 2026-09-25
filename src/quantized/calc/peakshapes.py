"""Peak-shape profiles for XRD/spectroscopy fitting. Ports of MATLAB +utilities.

Pure functions: positions in, profile out. Used by the fitting model library.
:func:`voigt` is new capability (MATLAB has none); it follows the same
peak-height convention (``height`` is the value at ``x0`` above ``bg``).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray
from scipy.special import voigt_profile

__all__ = [
    "AREA_G",
    "AREA_L",
    "gaussian",
    "lorentzian",
    "pseudo_voigt",
    "pseudo_voigt_area",
    "split_pearson_vii",
    "tch_pseudo_voigt",
    "voigt",
    "voigt_area",
    "voigt_sigma_gamma",
]

# Parameter vector: a plain sequence or a float ndarray (e.g. straight from an
# optimizer) — both are unpacked via float(...) so either works at runtime.
Params = Sequence[float] | NDArray[np.float64]

_LN2 = math.log(2)
_EPS = float(np.finfo(float).eps)

# Integrated area / (height * fwhm) of the unit-height profiles. The single
# home of these constants (peak_fit, peak_multifit and peak_model import them).
AREA_L = math.pi / 2.0  # Lorentzian
AREA_G = math.sqrt(math.pi) / (2.0 * math.sqrt(_LN2))  # Gaussian = sqrt(pi/ln 2)/2


def gaussian(x: NDArray[np.float64], x0: float, fwhm: float, height: float) -> NDArray[np.float64]:
    """H*exp(-4 ln2 ((x-x0)/fwhm)^2): pseudo_voigt's eta=0 branch, bit for bit."""
    u = (np.asarray(x, dtype=float) - x0) / fwhm
    return np.asarray(height * np.exp(-4.0 * _LN2 * u**2), dtype=float)


def lorentzian(x: NDArray[np.float64], x0: float, fwhm: float,
               height: float) -> NDArray[np.float64]:
    """H/(1 + 4((x-x0)/fwhm)^2): pseudo_voigt's eta=1 branch, bit for bit."""
    u = (np.asarray(x, dtype=float) - x0) / fwhm
    return np.asarray(height * (1.0 / (1.0 + 4.0 * u**2)), dtype=float)


def pseudo_voigt_area(height: float, fwhm: float, eta: float) -> float:
    """Area of H*(eta*L + (1-eta)*G): H*fwhm*(eta*AREA_L + (1-eta)*AREA_G).
    eta = 0 / 1 give the Gaussian / Lorentzian areas."""
    return height * fwhm * (eta * AREA_L + (1.0 - eta) * AREA_G)


def voigt_sigma_gamma(fwhm_g: float, fwhm_l: float) -> tuple[float, float]:
    """``scipy.special.voigt_profile``'s (sigma, gamma) from the component FWHMs."""
    return fwhm_g / (2.0 * math.sqrt(2.0 * _LN2)), fwhm_l / 2.0


def voigt_area(height: float, fwhm_g: float, fwhm_l: float) -> float:
    """Area of :func:`voigt` (height-scaled): H / V(0; sigma, gamma)."""
    sigma, gamma = voigt_sigma_gamma(fwhm_g, fwhm_l)
    return height / float(voigt_profile(0.0, sigma, gamma))


def pseudo_voigt(
    x: NDArray[np.float64],
    x0: float,
    fwhm: float,
    height: float,
    eta: float,
    bg: float = 0.0,
) -> NDArray[np.float64]:
    """Linear pseudo-Voigt: H·(eta·L + (1-eta)·G) + bg. Port of utilities.pseudoVoigt."""
    if fwhm <= 0:
        raise ValueError("fwhm must be positive")
    if not 0.0 <= eta <= 1.0:
        raise ValueError("eta must be in [0, 1]")
    xv = np.asarray(x, dtype=float)
    u = (xv - x0) / fwhm
    lorentz = 1.0 / (1.0 + 4.0 * u**2)
    gauss = np.exp(-4.0 * _LN2 * u**2)
    return height * (eta * lorentz + (1.0 - eta) * gauss) + bg


def voigt(
    x: NDArray[np.float64],
    x0: float,
    fwhm_g: float,
    fwhm_l: float,
    height: float,
    bg: float = 0.0,
) -> NDArray[np.float64]:
    """Voigt profile scaled to its peak height: H*V(x-x0)/V(0) + bg.

    ``V`` is the area-normalised convolution of a Gaussian of FWHM ``fwhm_g``
    (sigma = fwhm_g / (2*sqrt(2 ln 2))) with a Lorentzian of FWHM ``fwhm_l``
    (half-width gamma = fwhm_l / 2), via ``scipy.special.voigt_profile``. Either
    width may be 0 (pure Lorentzian / pure Gaussian), not both.
    """
    if fwhm_g < 0 or fwhm_l < 0 or (fwhm_g == 0 and fwhm_l == 0):
        raise ValueError("Voigt widths must be non-negative and not both zero")
    sigma, gamma = voigt_sigma_gamma(fwhm_g, fwhm_l)
    xv = np.asarray(x, dtype=float)
    peak0 = float(voigt_profile(0.0, sigma, gamma))
    return np.asarray(height * voigt_profile(xv - x0, sigma, gamma) / peak0 + bg, dtype=float)


def split_pearson_vii(x: NDArray[np.float64], params: Params) -> NDArray[np.float64]:
    """Asymmetric split Pearson VII. params = [H, center, wL, wR, mL, mR, baseline]."""
    height, center, w_l, w_r, m_l, m_r, baseline = (float(p) for p in params)
    if w_l <= 0 or w_r <= 0:
        raise ValueError("half-widths wL, wR must be positive")
    if m_l < 0.5 or m_r < 0.5:
        raise ValueError("shape exponents mL, mR must be >= 0.5")
    xv = np.asarray(x, dtype=float)
    y = np.zeros_like(xv)
    mask_l = xv < center
    mask_r = ~mask_l
    k_l = 2.0 ** (1.0 / m_l) - 1.0
    k_r = 2.0 ** (1.0 / m_r) - 1.0
    y[mask_l] = height * (1.0 + k_l * ((xv[mask_l] - center) / w_l) ** 2) ** (-m_l)
    y[mask_r] = height * (1.0 + k_r * ((xv[mask_r] - center) / w_r) ** 2) ** (-m_r)
    return y + baseline


def tch_pseudo_voigt(x: NDArray[np.float64], params: Params) -> NDArray[np.float64]:
    """Thompson-Cox-Hastings pseudo-Voigt. params = [H, x0, fG, fL, bg]."""
    height, x0, f_g, f_l, bg = (float(p) for p in params)
    f_g, f_l = abs(f_g), abs(f_l)
    if f_g < _EPS and f_l < _EPS:
        raise ValueError("at least one of fG, fL must be > 0")
    f5 = (
        f_g**5
        + 2.69269 * f_g**4 * f_l
        + 2.42843 * f_g**3 * f_l**2
        + 4.47163 * f_g**2 * f_l**3
        + 0.07842 * f_g * f_l**4
        + f_l**5
    )
    f = f5 ** (1.0 / 5.0)
    r = f_l / f
    eta = 1.36603 * r - 0.47719 * r**2 + 0.11116 * r**3
    eta = max(0.0, min(1.0, eta))
    xv = np.asarray(x, dtype=float)
    u = (xv - x0) / f
    lorentz = 1.0 / (1.0 + 4.0 * u**2)
    gauss = np.exp(-4.0 * _LN2 * u**2)
    result = height * (eta * lorentz + (1.0 - eta) * gauss) + bg
    return np.asarray(result, dtype=float)
