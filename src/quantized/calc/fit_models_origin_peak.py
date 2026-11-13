"""Origin built-in **Peak Functions** for the curve-fit registry.

Pure calc layer, imported for its registration side effects (see the bottom of
``fit_models``). Names, parameter order and formulas follow OriginLab's built-in
fitting-function library (category "Peak Functions"), so a parameter table
fitted here reads the same as Origin's. Widths are FWHM-type unless the
docstring says otherwise; ``A`` is the AREA in the area-parameterized forms
(Gauss, Lorentz, Voigt, PsdVoigt1/2, LogNormal) and the HEIGHT in GaussAmp.

The pre-existing MATLAB-parity models (``Gaussian``, ``Lorentzian``,
``Pseudo-Voigt``) are unchanged; these are additional, Origin-named models.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray
from scipy.special import voigt_profile

from .fit_models import register_model

FloatArray = NDArray[np.float64]

_INF = float("inf")
_LN2 = math.log(2.0)
_SQRT_PI_2 = math.sqrt(math.pi / 2.0)
_FWHM_PER_SIGMA = 2.0 * math.sqrt(2.0 * _LN2)

PEAK = "Peak Functions"


def gauss(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Gauss``: y = y0 + A/(w*sqrt(pi/2)) * exp(-2*((x-xc)/w)^2).

    Params (y0, xc, w, A). ``w`` = 2*sigma (so FWHM = w*sqrt(ln 4)); ``A`` = area.
    """
    y0, xc, w, a = (np.float64(v) for v in p[:4])
    return np.asarray(y0 + a / (w * _SQRT_PI_2) * np.exp(-2.0 * ((x - xc) / w) ** 2), dtype=float)


def gauss_amp(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``GaussAmp``: y = y0 + A*exp(-(x-xc)^2/(2*w^2)).

    Params (y0, xc, w, A). ``w`` = sigma; ``A`` = peak height above y0.
    """
    y0, xc, w, a = (np.float64(v) for v in p[:4])
    return np.asarray(y0 + a * np.exp(-((x - xc) ** 2) / (2.0 * w**2)), dtype=float)


def lorentz(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Lorentz``: y = y0 + (2*A/pi) * w/(4*(x-xc)^2 + w^2).

    Params (y0, xc, w, A). ``w`` = FWHM; ``A`` = area.
    """
    y0, xc, w, a = (np.float64(v) for v in p[:4])
    return np.asarray(y0 + (2.0 * a / math.pi) * w / (4.0 * (x - xc) ** 2 + w**2), dtype=float)


def voigt(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Voigt``: area-normalized convolution of a Gaussian and a Lorentzian.

    y = y0 + A * V(x - xc; wG, wL), with ``wG`` the Gaussian FWHM and ``wL`` the
    Lorentzian FWHM (Origin's convention). Evaluated exactly via the Faddeeva
    function: ``scipy.special.voigt_profile(x-xc, sigma=wG/(2*sqrt(2 ln 2)),
    gamma=wL/2)``. Params (y0, xc, A, wG, wL).
    """
    y0, xc, a, wg, wl = (np.float64(v) for v in p[:5])
    prof = voigt_profile(x - xc, abs(wg) / _FWHM_PER_SIGMA, abs(wl) / 2.0)
    return np.asarray(y0 + a * prof, dtype=float)


def _lorentz_unit(x: FloatArray, xc: float, w: float) -> FloatArray:
    return np.asarray((2.0 / math.pi) * w / (4.0 * (x - xc) ** 2 + w**2), dtype=float)


def _gauss_unit(x: FloatArray, xc: float, w: float) -> FloatArray:
    """Unit-area Gaussian of FWHM ``w`` (Origin's PsdVoigt Gaussian term)."""
    k = 4.0 * _LN2
    return np.asarray(math.sqrt(k) / (math.sqrt(math.pi) * w) * np.exp(-k * (x - xc) ** 2 / w**2),
                      dtype=float)


def psd_voigt1(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``PsdVoigt1``: area pseudo-Voigt, one shared FWHM ``w``.

    y = y0 + A*[mu*(2/pi)*w/(4(x-xc)^2+w^2)
                + (1-mu)*sqrt(4 ln2)/(sqrt(pi)*w)*exp(-(4 ln2/w^2)(x-xc)^2)].
    Params (y0, xc, A, w, mu); mu = Lorentzian fraction.
    """
    y0, xc, a, w, mu = (np.float64(v) for v in p[:5])
    mix = mu * _lorentz_unit(x, xc, w) + (1.0 - mu) * _gauss_unit(x, xc, w)
    return np.asarray(y0 + a * mix, dtype=float)


def psd_voigt2(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``PsdVoigt2``: as PsdVoigt1 with separate FWHMs ``wG`` and ``wL``.

    Params (y0, xc, A, wG, wL, mu); mu = Lorentzian fraction.
    """
    y0, xc, a, wg, wl, mu = (np.float64(v) for v in p[:6])
    mix = mu * _lorentz_unit(x, xc, wl) + (1.0 - mu) * _gauss_unit(x, xc, wg)
    return np.asarray(y0 + a * mix, dtype=float)


def log_normal(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``LogNormal``: y = y0 + A/(sqrt(2 pi)*w*x) * exp(-(ln(x/xc))^2/(2 w^2)).

    Params (y0, xc, w, A); ``A`` = area, ``w`` = log-standard deviation. Defined
    for x > 0 (x <= 0 evaluates to NaN, as in Origin).
    """
    y0, xc, w, a = (np.float64(v) for v in p[:4])
    with np.errstate(divide="ignore", invalid="ignore"):
        xp = np.where(x > 0, x, np.nan)
        gauss_ln = np.exp(-np.log(xp / xc) ** 2 / (2.0 * w**2))
        body = a / (math.sqrt(2.0 * math.pi) * w * xp) * gauss_ln
    return np.asarray(y0 + body, dtype=float)


def _logistic_unit(z: FloatArray) -> FloatArray:
    """1/(1+exp(-z)) without overflow warnings."""
    with np.errstate(over="ignore"):
        return np.asarray(1.0 / (1.0 + np.exp(-z)), dtype=float)


def asym2sig(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Asym2Sig`` (asymmetric double sigmoid):

    y = y0 + A * 1/(1+exp(-(x-xc+w1/2)/w2)) * (1 - 1/(1+exp(-(x-xc-w1/2)/w3))).
    Params (y0, xc, A, w1, w2, w3): w1 = plateau width, w2/w3 = left/right edge
    widths.
    """
    y0, xc, a, w1, w2, w3 = (np.float64(v) for v in p[:6])
    rise = _logistic_unit((x - xc + w1 / 2.0) / w2)
    fall = 1.0 - _logistic_unit((x - xc - w1 / 2.0) / w3)
    return np.asarray(y0 + a * rise * fall, dtype=float)


register_model("Gauss", PEAK, gauss, ["y0", "xc", "w", "A"], [0, 0, 1, 1],
               [-_INF, -_INF, 0, -_INF], [_INF] * 4)
register_model("GaussAmp", PEAK, gauss_amp, ["y0", "xc", "w", "A"], [0, 0, 1, 1],
               [-_INF, -_INF, 0, -_INF], [_INF] * 4)
register_model("Lorentz", PEAK, lorentz, ["y0", "xc", "w", "A"], [0, 0, 1, 1],
               [-_INF, -_INF, 0, -_INF], [_INF] * 4)
register_model("Voigt", PEAK, voigt, ["y0", "xc", "A", "wG", "wL"], [0, 0, 1, 1, 1],
               [-_INF, -_INF, -_INF, 0, 0], [_INF] * 5)
register_model("PsdVoigt1", PEAK, psd_voigt1, ["y0", "xc", "A", "w", "mu"], [0, 0, 1, 1, 0.5],
               [-_INF, -_INF, -_INF, 0, 0], [_INF, _INF, _INF, _INF, 1])
register_model("PsdVoigt2", PEAK, psd_voigt2, ["y0", "xc", "A", "wG", "wL", "mu"],
               [0, 0, 1, 1, 1, 0.5], [-_INF, -_INF, -_INF, 0, 0, 0],
               [_INF, _INF, _INF, _INF, _INF, 1])
register_model("LogNormal", PEAK, log_normal, ["y0", "xc", "w", "A"], [0, 1, 0.5, 1],
               [-_INF, 0, 0, -_INF], [_INF] * 4)
register_model("Asym2Sig", PEAK, asym2sig, ["y0", "xc", "A", "w1", "w2", "w3"],
               [0, 0, 1, 1, 0.2, 0.2], [-_INF, -_INF, -_INF, 0, 0, 0], [_INF] * 6)
