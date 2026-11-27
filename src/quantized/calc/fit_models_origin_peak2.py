"""More Origin built-in **Peak Functions** (category "Peak Functions").

Pure calc layer, imported for its registration side effects. Names, parameter
order and default bounds follow the Origin installation's function library;
only formulas and parameter names are recorded. Declared with
``fit_models_origin_dsl.define``.

Notes
-----
* Origin's ``Gaussian`` (FWHM form: y0, xc, A, w) shares its name with
  quantized's MATLAB-parity ``Gaussian`` (A, mu, sigma), so it is registered as
  ``Gaussian (Origin)``.
* ``GaussMod`` is evaluated as ``A/t0 * exp(-(x-xc)^2/(2 w^2)) * erfcx(-z/sqrt2)/2``
  with ``z = (x-xc)/w - w/t0``: algebraically identical to the exponentially
  modified Gaussian, but without the exp(+) * erfc(-) overflow far left of xc.
  ``Giddings`` uses ``i1e`` for the same reason.
* ``Beta`` and ``Weibull3`` have compact (one-sided) support: outside it the
  peak term is 0 (so the curve is the baseline ``y0``), not NaN. Origin instead
  leaves those points undefined and drops them from the fit (fixtures fit_beta,
  fit_weibull3: n = 15 and 56 of 60). Matching that would need every fit path
  (single, global, robust, bumps, batch, the curve JSON) to mask a declared
  model's non-finite values, which is a cross-cutting change to fitting.py and the
  route start logic; the convention is kept and stated in each description.
* ``SchulzFlory`` takes ``x``, ``xc`` and ``w`` as base-10 logarithms (see ``_schulzflory``);
  its published formula text is the same expression in the linear variables.
* Not ported: CCE (nine parameters, two interacting components), HVL,
  FraserSuzuki (its formula tests ``x < 0`` rather than ``x < xc``),
  ConsGaussian (``w1`` and ``w2`` enter only as ``xc*w2 + w1``, so a single
  peak cannot determine both), PearsonIV and the two-curve GaussianLorentz.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray
from scipy.special import erfcx, gammaln, i1e

from .fit_models_origin_dsl import define

FloatArray = NDArray[np.float64]
PEAK = "Peak Functions"
E = np.exp
_LN2 = math.log(2.0)
_LN10 = math.log(10.0)
_SQ2PI = math.sqrt(2.0 * math.pi)
_PK = "xc=pkx w=pkw"
_W = {"w": 0.0}

def _side(x: FloatArray, xc: float, w1: float, w2: float) -> FloatArray:
    """The width on x's side of the centre: w1 left of xc, w2 right (and at) xc."""
    return np.asarray(np.where(x < xc, w1, w2), dtype=float)


define("Gaussian (Origin)", PEAK, "y0,xc,A,w",
       lambda x, y0, xc, a, w: y0 + a / (w * math.sqrt(math.pi / (4 * _LN2)))
       * E(-4 * _LN2 * (x - xc) ** 2 / w**2),
       lin="y0,A", kinds=_PK, lb=_W)
define("Composite", PEAK, "y0,xc,w,A",
       lambda x, y0, xc, w, a: y0 + a / (w * math.sqrt(math.pi / 2)) * E(-2 * ((x - xc) / w) ** 2),
       lin="y0,A", kinds=_PK, lb=_W)
define("AsymmetricGaussian", PEAK, "y0,xc,w1,w2,A",
       lambda x, y0, xc, w1, w2, a: y0 + a * E(-0.5 * ((x - xc) / _side(x, xc, w1, w2)) ** 2),
       lin="y0,A", kinds="xc=pkx w1=pkw w2=pkw", lb={"w1": 0.0, "w2": 0.0})
define("Bigaussian", PEAK, "y0,xc,H,w1,w2",
       lambda x, y0, xc, h, w1, w2: y0 + h * E(
           -((x - xc) ** 2) / (2 * _side(x, xc, w1, w2) ** 2)),
       lin="y0,H", kinds="xc=pkx w1=pkw w2=pkw", lb={"w1": 0.0, "w2": 0.0})
define("DoniachSunjic", PEAK, "y0,xc,H,w,a",
       lambda x, y0, xc, h, w, a: y0 + h * np.cos(
           math.pi * a / 2 + (1 - a) * np.arctan((x - xc) / w))
       / (w**2 + (x - xc) ** 2) ** ((1 - a) / 2),
       lin="y0,H", kinds=f"{_PK} a=c3")
define("BWF", PEAK, "y0,xc,H,w,q",
       lambda x, y0, xc, h, w, q: y0 + h * (1 + (x - xc) / (q * w)) ** 2
       / (1 + ((x - xc) / w) ** 2),
       lin="y0,H", kinds=f"{_PK} q=sq")
define("Gaussian_LorenCross", PEAK, "y0,xc,A,w,s",
       lambda x, y0, xc, a, w, s: y0 + a / (1 + s * ((x - xc) / w) ** 2
                                           * E(0.5 * (1 - s) * ((x - xc) / w) ** 2)),
       lin="y0,A", kinds=f"{_PK} s=u")


def _gauss_mod(x, y0, a, xc, w, t0):  # type: ignore[no-untyped-def]
    z = (x - xc) / w - w / t0
    return y0 + a / t0 * E(-((x - xc) ** 2) / (2 * w**2)) * erfcx(-z / math.sqrt(2)) / 2


define("GaussMod", PEAK, "y0,A,xc,w,t0", _gauss_mod, lin="y0,A", kinds="xc=pkx w=pkw t0=pkw",
       lb={"w": 0.0, "t0": 0.0})


def _giddings(x, y0, xc, w, a):  # type: ignore[no-untyped-def]
    z = 2 * np.sqrt(xc * x) / w
    return y0 + (a / w) * np.sqrt(xc / x) * i1e(z) * E(-((np.sqrt(x) - np.sqrt(xc)) ** 2) / w)


define("Giddings", PEAK, "y0,xc,w,A", _giddings, lin="y0,A", kinds=_PK, lb=_W, positive_x=True)


def _logistpk(x, y0, xc, w, a):  # type: ignore[no-untyped-def]
    t = E(-np.abs((x - xc) / w))  # 4 e^-z / (1 + e^-z)^2 is even in z
    return y0 + 4 * a * t / (1 + t) ** 2


define("Logistpk", PEAK, "y0,xc,w,A", _logistpk, lin="y0,A", kinds=_PK, lb=_W)
define("InvsPoly", PEAK, "y0,xc,w,A,A1,A2,A3",
       lambda x, y0, xc, w, a, a1, a2, a3: y0 + a / (1 + a1 * (2 * (x - xc) / w) ** 2
                                                    + a2 * (2 * (x - xc) / w) ** 4
                                                    + a3 * (2 * (x - xc) / w) ** 6),
       lin="y0,A", kinds=f"{_PK} A1=c3 A2=c3 A3=c3", lb=_W)


def _beta(x, y0, xc, a, w1, w2, w3):  # type: ignore[no-untyped-def]
    u = (x - xc) / w1
    left = np.maximum(1 + (w2 + w3 - 2) / (w2 - 1) * u, 0.0)
    right = np.maximum(1 - (w2 + w3 - 2) / (w3 - 1) * u, 0.0)
    return y0 + a * left ** (w2 - 1) * right ** (w3 - 1)


_SUPPORT_NOTE = (
    "Outside its support the curve is the baseline y0 and those points stay in the fit; "
    "Origin leaves them undefined and drops them from its fit, so counts and sums of squares "
    "differ from Origin's when data lie outside the support."
)
define("Beta", PEAK, "y0,xc,A,w1,w2,w3", _beta, lin="y0,A", kinds="xc=pkx w1=pkw w2=b23 w3=b23",
       lb={"w1": 0.0, "w2": 1.0, "w3": 1.0}, p0={"w2": 2.0, "w3": 2.0}, note=_SUPPORT_NOTE)
define("Extreme", PEAK, "y0,xc,w,A",
       lambda x, y0, xc, w, a: y0 + a * E(-E(-(x - xc) / w) - (x - xc) / w + 1),
       lin="y0,A", kinds=_PK, lb=_W)


def _weibull3(x, y0, xc, a, w1, w2):  # type: ignore[no-untyped-def]
    c = (w2 - 1) / w2
    s = (x - xc) / w1 + c ** (1 / w2)
    sp = np.maximum(s, 0.0)
    body = a * c ** ((1 - w2) / w2) * sp ** (w2 - 1) * E(-(sp**w2) + c)
    return y0 + np.where(s > 0, body, 0.0)


define("Weibull3", PEAK, "y0,xc,A,w1,w2", _weibull3, lin="y0,A", kinds="xc=pkx w1=pkw w2=b23",
       lb={"w1": 0.0, "w2": 0.0}, p0={"w2": 2.0}, note=_SUPPORT_NOTE)


def _ecs(x, y0, xc, a, w, a3, a4):  # type: ignore[no-untyped-def]
    u = (x - xc) / w
    series = (1 + (a3 / 6) * u * (u**2 - 3) + (a4 / 24) * (u**4 - 6 * u**3 + 3)
              + (10 * a3**2 / 720) * (u**6 - 15 * u**4 + 45 * u**2 - 15))
    return y0 + a / (w * _SQ2PI) * (E(-0.5 * u**2) * series)


def _gcas(x, y0, xc, a, w, a3, a4):  # type: ignore[no-untyped-def]
    u = (x - xc) / w
    series = 1 + (a3 / 6) * (u**3 - 3 * u) + (a4 / 24) * (u**4 - 6 * u**2 + 3)
    return y0 + a / (w * _SQ2PI) * E(-(u**2) / 2) * series


define("ECS", PEAK, "y0,xc,A,w,a3,a4", _ecs, lin="y0,A", kinds=f"{_PK} a3=c3 a4=c3",
       lb={"A": 0.0, "w": 0.0})
define("GCAS", PEAK, "y0,xc,A,w,a3,a4", _gcas, lin="y0,A", kinds=f"{_PK} a3=c3 a4=c3", lb=_W)


def _pearson7(x, y0, xc, a, w, m):  # type: ignore[no-untyped-def]
    k = 2 ** (1 / m) - 1
    norm = 2 * np.exp(gammaln(m) - gammaln(m - 0.5)) * np.sqrt(k) / (math.sqrt(math.pi) * w)
    return y0 + a * norm * (1 + 4 * k / w**2 * (x - xc) ** 2) ** (-m)


define("PearsonVII", PEAK, "y0,xc,A,w,m", _pearson7, lin="y0,A", kinds="xc=pkx w=pkw m=pm",
       lb={"A": 0.0, "w": 0.0, "m": 0.5}, ub={"m": 170.0}, p0={"m": 2.0})
def _schulzflory(x, y0, xc, w, a):  # type: ignore[no-untyped-def]
    # Origin's definition text reads y0 + A*exp((xc-x)/w)*(x/xc)^(xc/w), but Origin EVALUATES
    # it with x, xc and w as base-10 logarithms (the polymer-mass axis is log M): the same
    # expression in u = 10^x, uc = 10^xc, W = 10^w. Evidence: fixture fit_schulzflory, where
    # the model below reproduces Origin's fitted curve (1000 points) to 9e-16 and its residual
    # sum of squares to 1e-15; the text formula gives 2.3 against Origin's 0.0748 and no
    # permutation of the parameters helps. The (x/xc)^(xc/w) factor is folded into the
    # exponent so that a large x cannot overflow it.
    u, uc, ww = 10.0**x, 10.0**xc, 10.0**w
    return y0 + a * E((uc - u) / ww + (uc / ww) * _LN10 * (x - xc))


define("SchulzFlory", PEAK, "y0,xc,w,A", _schulzflory, lin="y0,A", kinds="xc=pkx w=lw",
       lb={"xc": 0.0, "w": 0.0})
