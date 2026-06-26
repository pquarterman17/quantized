"""Peak-shape profiles for XRD/spectroscopy fitting. Ports of MATLAB +utilities.

Pure functions: positions in, profile out. Used by the fitting model library.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

__all__ = ["pseudo_voigt", "split_pearson_vii", "tch_pseudo_voigt"]

# Parameter vector: a plain sequence or a float ndarray (e.g. straight from an
# optimizer) — both are unpacked via float(...) so either works at runtime.
Params = Sequence[float] | NDArray[np.float64]

_LN2 = math.log(2)
_EPS = float(np.finfo(float).eps)


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
