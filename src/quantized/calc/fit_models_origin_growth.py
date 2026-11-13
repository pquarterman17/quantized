"""Origin built-in **Growth/Sigmoidal** functions for the curve-fit registry.

Pure calc layer, imported for its registration side effects (see the bottom of
``fit_models``). Names, parameter order and formulas follow OriginLab's
built-in library (category "Growth/Sigmoidal"). One rename: Origin's
``Logistic`` is registered as ``"Logistic (Origin)"`` because the name
``Logistic`` already belongs to the MATLAB-parity model (A/(1+exp(-k(x-x0)))+C),
whose golden values are frozen.

Every name, parameter order and default bound was checked against the Origin
Help page cited in the function's docstring (see docs/fit_models.md).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .fit_models import register_model

FloatArray = NDArray[np.float64]

_INF = float("inf")
GROWTH = "Growth/Sigmoidal"


def _pos(x: FloatArray) -> FloatArray:
    """x where x > 0, NaN elsewhere (power-law sigmoids are defined for x > 0)."""
    return np.asarray(np.where(x > 0, x, np.nan), dtype=float)


def boltzmann(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Boltzmann``: y = A2 + (A1-A2)/(1+exp((x-x0)/dx)). Params (A1, A2, x0, dx).

    Origin sets no bounds.
    https://www.originlab.com/doc/Origin-Help/Boltzmann-FitFunc
    """
    a1, a2, x0, dx = (np.float64(v) for v in p[:4])
    with np.errstate(over="ignore"):
        return np.asarray(a2 + (a1 - a2) / (1.0 + np.exp((x - x0) / dx)), dtype=float)


def dose_resp(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``DoseResp``: y = A1 + (A2-A1)/(1+10^((LOGx0-x)*p)).

    Params (A1, A2, LOGx0, p); x is log10(dose). A1 = bottom, A2 = top asymptote.

    Origin sets no bounds.
    https://www.originlab.com/doc/Origin-Help/DoseResp-FitFunc
    """
    a1, a2, logx0, hill = (np.float64(v) for v in p[:4])
    with np.errstate(over="ignore"):
        return np.asarray(a1 + (a2 - a1) / (1.0 + 10.0 ** ((logx0 - x) * hill)), dtype=float)


def hill(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Hill``: y = Vmax*x^n/(k^n + x^n). Params (Vmax, k, n); x >= 0.

    Origin bounds: Vmax > 0, k > 0, n > 0.
    https://www.originlab.com/doc/Origin-Help/Hill-FitFunc
    """
    vmax, k, n = (np.float64(v) for v in p[:3])
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        xn = np.where(x >= 0, x, np.nan) ** n
        return np.asarray(vmax * xn / (k**n + xn), dtype=float)


def hill1(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Hill1``: y = START + (END-START)*x^n/(k^n + x^n). Params (START, END, k, n).

    Origin bounds: k > 0, n > 0.
    https://www.originlab.com/doc/Origin-Help/Hill1-FitFunc
    """
    start, end, k, n = (np.float64(v) for v in p[:4])
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        xn = np.where(x >= 0, x, np.nan) ** n
        return np.asarray(start + (end - start) * xn / (k**n + xn), dtype=float)


def michaelis_menten(x: FloatArray, p: FloatArray) -> FloatArray:
    """Michaelis-Menten: y = Vmax*x/(Km + x). Params (Vmax, Km).

    Origin ``MichaelisMenten`` (the same curve as ``Hill`` with n = 1).

    Origin bounds: Vmax > 0, Km > 0.
    https://www.originlab.com/doc/Origin-Help/MichaelisMenten-FitFunc
    """
    vmax, km = np.float64(p[0]), np.float64(p[1])
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.asarray(vmax * x / (km + x), dtype=float)


def logistic_origin(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Logistic``: y = A2 + (A1-A2)/(1+(x/x0)^p). Params (A1, A2, x0, p); x > 0.

    Origin bound: p > 0.
    https://www.originlab.com/doc/Origin-Help/Logistic-FitFunc
    """
    a1, a2, x0, pw = (np.float64(v) for v in p[:4])
    with np.errstate(over="ignore", invalid="ignore"):
        return np.asarray(a2 + (a1 - a2) / (1.0 + (_pos(x) / x0) ** pw), dtype=float)


def logistic5(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Logistic5`` (5PL): y = Amin + (Amax-Amin)/(1+(x/x0)^(-h))^s.

    Params (Amin, Amax, x0, h, s); x > 0. Origin bound: s > 0.
    https://www.originlab.com/doc/Origin-Help/Logistic5-FitFunc
    """
    amin, amax, x0, h, s = (np.float64(v) for v in p[:5])
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        return np.asarray(amin + (amax - amin) / (1.0 + (_pos(x) / x0) ** (-h)) ** s, dtype=float)


def slogistic1(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``SLogistic1``: y = a/(1+exp(-k*(x-xc))). Params (a, xc, k).

    Origin bound: xc > 0.
    https://www.originlab.com/doc/Origin-Help/SLogistic1-FitFunc
    """
    a, xc, k = (np.float64(v) for v in p[:3])
    with np.errstate(over="ignore"):
        return np.asarray(a / (1.0 + np.exp(-k * (x - xc))), dtype=float)


def sgompertz(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``SGompertz``: y = a*exp(-exp(-k*(x-xc))). Params (a, xc, k).

    Origin bounds: a > 0, k > 0.
    https://www.originlab.com/doc/Origin-Help/SGompertz-FitFunc
    """
    a, xc, k = (np.float64(v) for v in p[:3])
    with np.errstate(over="ignore"):
        return np.asarray(a * np.exp(-np.exp(-k * (x - xc))), dtype=float)


def sweibull1(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``SWeibull1``: y = A*(1 - exp(-(k*(x-xc))^d)). Params (A, xc, d, k).

    Origin bounds: A > 0, k > 0. Origin leaves x < xc undefined (a negative
    base to a real power); here ``k*(x-xc)`` is clamped at 0 so the curve is
    flat at 0 before onset instead of NaN.
    https://www.originlab.com/doc/Origin-Help/SWeibull1-FitFunc
    """
    a, xc, d, k = (np.float64(v) for v in p[:4])
    z = np.maximum(k * (x - xc), 0.0)
    with np.errstate(over="ignore", invalid="ignore"):
        return np.asarray(a * (1.0 - np.exp(-(z**d))), dtype=float)


# Bounds are OriginLab's documented defaults for each function (lower bounds
# only; Origin sets no upper bounds on any of these).
register_model("Boltzmann", GROWTH, boltzmann, ["A1", "A2", "x0", "dx"], [0, 1, 0, 1],
               [-_INF] * 4, [_INF] * 4)
register_model("DoseResp", GROWTH, dose_resp, ["A1", "A2", "LOGx0", "p"], [0, 1, 0, 1],
               [-_INF] * 4, [_INF] * 4)
register_model("Hill", GROWTH, hill, ["Vmax", "k", "n"], [1, 1, 1],
               [0, 0, 0], [_INF] * 3)
register_model("Hill1", GROWTH, hill1, ["START", "END", "k", "n"], [0, 1, 1, 1],
               [-_INF, -_INF, 0, 0], [_INF] * 4)
register_model("MichaelisMenten", GROWTH, michaelis_menten, ["Vmax", "Km"], [1, 1],
               [0, 0], [_INF] * 2)
register_model("Logistic (Origin)", GROWTH, logistic_origin, ["A1", "A2", "x0", "p"],
               [0, 1, 1, 1], [-_INF, -_INF, -_INF, 0], [_INF] * 4)
register_model("Logistic5", GROWTH, logistic5, ["Amin", "Amax", "x0", "h", "s"],
               [0, 1, 1, 1, 1], [-_INF, -_INF, -_INF, -_INF, 0], [_INF] * 5)
register_model("SLogistic1", GROWTH, slogistic1, ["a", "xc", "k"], [1, 1, 1],
               [-_INF, 0, -_INF], [_INF] * 3)
register_model("SGompertz", GROWTH, sgompertz, ["a", "xc", "k"], [1, 0, 1],
               [0, -_INF, 0], [_INF] * 3)
register_model("SWeibull1", GROWTH, sweibull1, ["A", "xc", "d", "k"], [1, 0, 2, 1],
               [0, -_INF, -_INF, 0], [_INF] * 4)
