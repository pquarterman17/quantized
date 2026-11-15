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
from scipy.optimize import brentq
from scipy.special import voigt_profile

__all__ = [
    "AREA_G",
    "AREA_L",
    "doniach_sunjic",
    "doniach_sunjic_fwhm",
    "fano",
    "fano_fwhm",
    "gaussian",
    "lorentzian",
    "pearson_vii",
    "pearson_vii_area",
    "pseudo_voigt",
    "pseudo_voigt_area",
    "split_gaussian",
    "split_lorentzian",
    "split_pearson_vii",
    "split_pseudo_voigt",
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


# ── shapes of the mixed-shape peak model (gap audit 4 G5; new capability) ────
#
# Every profile below takes its PEAK-HEIGHT parameter ``height`` as its value
# AT ``x0`` (the convention of every shape above). For the split shapes and
# Pearson VII that is also the maximum; for Fano/BWF and Doniach-Sunjic the
# maximum lies off ``x0`` (each docstring gives where). Areas are closed forms
# where the integral is finite; Fano/BWF (inv_q != 0) and Doniach-Sunjic
# (alpha > 0) have tails that do not integrate, so they have no area.


def _split(x: NDArray[np.float64], x0: float, fwhm_left: float,
           fwhm_right: float) -> NDArray[np.float64]:
    """(x - x0)/w with w = fwhm_left below x0 and fwhm_right at or above it."""
    if fwhm_left <= 0 or fwhm_right <= 0:
        raise ValueError("fwhm_left and fwhm_right must be positive")
    xv = np.asarray(x, dtype=float)
    return np.asarray((xv - x0) / np.where(xv < x0, fwhm_left, fwhm_right), dtype=float)


def split_gaussian(x: NDArray[np.float64], x0: float, fwhm_left: float, fwhm_right: float,
                   height: float) -> NDArray[np.float64]:
    """Asymmetric (bi-)Gaussian: a Gaussian of FWHM ``fwhm_left`` below x0 and
    ``fwhm_right`` above. FWHM = (fwhm_left + fwhm_right)/2; area =
    H*AREA_G*(fwhm_left + fwhm_right)/2. Equal widths = :func:`gaussian`."""
    u = _split(x, x0, fwhm_left, fwhm_right)
    return np.asarray(height * np.exp(-4.0 * _LN2 * u**2), dtype=float)


def split_lorentzian(x: NDArray[np.float64], x0: float, fwhm_left: float, fwhm_right: float,
                     height: float) -> NDArray[np.float64]:
    """Asymmetric Lorentzian, split like :func:`split_gaussian`; area =
    H*AREA_L*(fwhm_left + fwhm_right)/2."""
    u = _split(x, x0, fwhm_left, fwhm_right)
    return np.asarray(height * (1.0 / (1.0 + 4.0 * u**2)), dtype=float)


def split_pseudo_voigt(x: NDArray[np.float64], x0: float, fwhm_left: float, fwhm_right: float,
                       height: float, eta: float) -> NDArray[np.float64]:
    """Asymmetric pseudo-Voigt: each side H*(eta*L + (1-eta)*G) of its own FWHM,
    one eta. FWHM = (fwhm_left + fwhm_right)/2; area = that FWHM times
    H*(eta*AREA_L + (1-eta)*AREA_G)."""
    if not 0.0 <= eta <= 1.0:
        raise ValueError("eta must be in [0, 1]")
    u = _split(x, x0, fwhm_left, fwhm_right)
    lorentz = 1.0 / (1.0 + 4.0 * u**2)
    gauss = np.exp(-4.0 * _LN2 * u**2)
    return np.asarray(height * (eta * lorentz + (1.0 - eta) * gauss), dtype=float)


def pearson_vii(x: NDArray[np.float64], x0: float, fwhm: float, height: float,
                m: float) -> NDArray[np.float64]:
    """Pearson VII: H*(1 + 4(2^(1/m) - 1)((x-x0)/fwhm)^2)^(-m). ``fwhm`` is the
    exact FWHM; m = 1 is the Lorentzian, m -> inf the Gaussian."""
    if fwhm <= 0:
        raise ValueError("fwhm must be positive")
    if m < 0.5:
        raise ValueError("the Pearson VII exponent m must be >= 0.5")
    u = (np.asarray(x, dtype=float) - x0) / fwhm
    k = 2.0 ** (1.0 / m) - 1.0
    return np.asarray(height * (1.0 + 4.0 * k * u**2) ** (-m), dtype=float)


def pearson_vii_area(height: float, fwhm: float, m: float) -> float:
    """H*fwhm*sqrt(pi)*Gamma(m - 1/2) / (2*sqrt(2^(1/m) - 1)*Gamma(m)); infinite
    at m = 1/2 (returned as inf)."""
    if m <= 0.5:
        return math.inf
    k = 2.0 ** (1.0 / m) - 1.0
    ratio = math.exp(math.lgamma(m - 0.5) - math.lgamma(m))
    return height * fwhm * math.sqrt(math.pi) * ratio / (2.0 * math.sqrt(k))


def fano(x: NDArray[np.float64], x0: float, fwhm: float, height: float,
         inv_q: float) -> NDArray[np.float64]:
    """Breit-Wigner-Fano: H*(1 + s*u)^2 / (1 + u^2), u = 2(x - x0)/fwhm,
    s = ``inv_q`` = 1/q. s = 0 is the Lorentzian of FWHM ``fwhm``. The maximum
    H*(1 + s^2) lies at x0 + s*fwhm/2; far from x0 the profile tends to H*s^2,
    so it has no finite area unless s = 0."""
    if fwhm <= 0:
        raise ValueError("fwhm must be positive")
    u = 2.0 * (np.asarray(x, dtype=float) - x0) / fwhm
    return np.asarray(height * (1.0 + inv_q * u) ** 2 / (1.0 + u**2), dtype=float)


def fano_fwhm(fwhm: float, inv_q: float) -> float | None:
    """Full width at half the maximum H*(1 + s^2), closed form (the two roots of
    (1 + s u)^2 = (1 + s^2)(1 + u^2)/2): fwhm*sqrt(s^2 + a^2)/|a| with
    a = (s^2 - 1)/2. Defined only for |s| < 1: otherwise the asymptote H*s^2
    is at or above half the maximum and the peak has no half-maximum width."""
    a = 0.5 * (inv_q**2 - 1.0)
    if a >= 0:
        return None
    return fwhm * math.sqrt(inv_q**2 + a**2) / abs(a)


def doniach_sunjic(x: NDArray[np.float64], x0: float, fwhm: float, height: float,
                   alpha: float) -> NDArray[np.float64]:
    """Doniach-Sunjic (1970), scaled so its value at x0 is H:

        H * cos(pi*alpha/2 + (1 - alpha)*atan(u)) / (cos(pi*alpha/2) * (1 + u^2)^((1-alpha)/2))

    with u = 2(x0 - x)/fwhm: the asymmetric tail runs toward HIGHER x (the
    binding-energy axis convention of XPS). alpha = 0 is the Lorentzian of
    FWHM ``fwhm``; 0 <= alpha < 1. The maximum lies at
    x0 + (fwhm/2)*tan(pi*alpha/(2(2 - alpha))); the high-x tail decays as
    |x|^-(1-alpha), so for alpha > 0 the area is infinite."""
    if fwhm <= 0:
        raise ValueError("fwhm must be positive")
    if not 0.0 <= alpha < 1.0:
        raise ValueError("alpha must be in [0, 1)")
    u = 2.0 * (x0 - np.asarray(x, dtype=float)) / fwhm
    beta = 1.0 - alpha
    phi0 = 0.5 * math.pi * alpha
    num = np.cos(phi0 + beta * np.arctan(u))
    return np.asarray(height * num / (math.cos(phi0) * (1.0 + u**2) ** (0.5 * beta)), dtype=float)


def doniach_sunjic_fwhm(fwhm: float, alpha: float) -> float:
    """Full width at half maximum of :func:`doniach_sunjic`. With u = tan(t) the
    profile is g(t) = cos(phi0 + beta*t)*cos(t)^beta, increasing below
    t* = -pi*alpha/(2(2 - alpha)) (its maximum) and decreasing above, and 0 at
    t = +-pi/2; the two half-maximum crossings are found by bracketed root
    finding (brentq) on each side. Exactly ``fwhm`` at alpha = 0."""
    beta, phi0 = 1.0 - alpha, 0.5 * math.pi * alpha
    t_max = -phi0 / (2.0 - alpha)

    def g(t: float) -> float:
        return float(math.cos(phi0 + beta * t) * max(math.cos(t), 0.0) ** beta)

    half = 0.5 * g(t_max)
    lo = brentq(lambda t: g(t) - half, -0.5 * math.pi, t_max, xtol=1e-15, rtol=1e-15)
    hi = brentq(lambda t: g(t) - half, t_max, 0.5 * math.pi, xtol=1e-15, rtol=1e-15)
    return 0.5 * fwhm * (math.tan(float(hi)) - math.tan(float(lo)))
