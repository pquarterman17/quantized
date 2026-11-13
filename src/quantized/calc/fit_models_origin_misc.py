"""Origin built-in **Polynomial**, **Power** and **Waveform** functions.

Pure calc layer, imported for its registration side effects (see the bottom of
``fit_models``). Names, parameter order, formulas and default bounds were
checked against the Origin Help page cited for each function:

* Polynomial — ``Poly5``: y = A0 + A1*x + ... + A5*x^5, params A0..A5
  (https://www.originlab.com/doc/Origin-Help/Poly5-FitFunc). ``Poly``:
  Origin's 9th-order polynomial, params a0..a9 in lowercase as Origin names
  them (https://www.originlab.com/doc/Origin-Help/Poly-FitFunc).
  ``Poly 6``/``Poly 7``/``Poly 8`` and ``Proportional`` (y = A*x) are NOT
  Origin fitting functions: Origin reaches those orders through its Polynomial
  Fit tool (orders 1-9), and a line through the origin by fixing the intercept
  of ``Line``. They are quantized conveniences with the same ascending
  A0..An convention. (The MATLAB-parity ``Quadratic``/``Cubic``/``Poly 4`` keep
  their descending a, b, c... order and golden values.)
* Power — ``Allometric1``: y = a*x^b, no bounds (x < 0 with a non-integer b is
  NaN, as in Origin — the MATLAB-parity ``Allometric`` uses |x|).
  https://www.originlab.com/doc/Origin-Help/Allometric1-FitFunc
* Waveform — ``Sine``: y = y0 + A*sin(pi*(x-xc)/w), params in Origin's order
  (xc, w, A, y0), bound w > 0; w is the HALF period.
  https://www.originlab.com/doc/Origin-Help/Sine-FitFunc
  ``SineDamp``: y = y0 + A*exp(-x/t0)*sin(pi*(x-xc)/w), params
  (y0, xc, w, t0, A), bounds w > 0 and t0 > 0.
  https://www.originlab.com/doc/Origin-Help/SineDamp-FitFunc
  The parameter ORDER follows that English page (y0, xc, w, t0, A); the
  German translation of the page lists them in a different order — the
  English page is the source used here (fitting integration review).
  Origin does not bound A, so a fit is unique only up to (A, xc) ->
  (-A, xc + w) and xc mod 2w.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from .fit_models import register_model

FloatArray = NDArray[np.float64]
ModelFn = Callable[[FloatArray, FloatArray], FloatArray]

_INF = float("inf")
POLYNOMIAL = "Polynomial"
POWER = "Power"
WAVEFORM = "Waveform"

# Origin's polynomial fit stops at order 9. order -> (registry name, Origin's
# coefficient prefix): Poly5 uses A0..A5, the 9th-order Poly uses a0..a9.
POLY_MODELS: dict[int, tuple[str, str]] = {
    5: ("Poly5", "A"), 6: ("Poly 6", "A"), 7: ("Poly 7", "A"), 8: ("Poly 8", "A"),
    9: ("Poly", "a"),
}


def make_poly(order: int) -> ModelFn:
    """Origin ``Poly`` of the given order: y = A0 + A1*x + ... + An*x^n."""

    def fcn(x: FloatArray, p: FloatArray) -> FloatArray:
        # Horner, highest power first; p is ascending A0..An.
        out = np.full(x.shape, np.float64(p[order]), dtype=float)
        for k in range(order - 1, -1, -1):
            out = out * x + np.float64(p[k])
        return np.asarray(out, dtype=float)

    fcn.__doc__ = f"Origin Poly, order {order}: y = A0 + A1*x + ... + A{order}*x^{order}."
    return fcn


def proportional(x: FloatArray, p: FloatArray) -> FloatArray:
    """y = A*x (line through the origin). Params (A,).

    Not an Origin fitting function: Origin fits this as ``Line`` with the
    intercept fixed at 0.
    """
    return np.asarray(np.float64(p[0]) * x, dtype=float)


def allometric1(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Allometric1``: y = a*x^b. Params (a, b)."""
    a, b = np.float64(p[0]), np.float64(p[1])
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        return np.asarray(a * np.power(x, b), dtype=float)


def sine(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Sine``: y = y0 + A*sin(pi*(x-xc)/w). Params (xc, w, A, y0); period = 2w."""
    xc, w, a, y0 = (np.float64(v) for v in p[:4])
    return np.asarray(y0 + a * np.sin(math.pi * (x - xc) / w), dtype=float)


def sine_damp(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``SineDamp``: y = y0 + A*exp(-x/t0)*sin(pi*(x-xc)/w). Params (y0, xc, w, t0, A)."""
    y0, xc, w, t0, a = (np.float64(v) for v in p[:5])
    with np.errstate(over="ignore", invalid="ignore"):
        env = np.exp(-x / t0)
        return np.asarray(y0 + a * env * np.sin(math.pi * (x - xc) / w), dtype=float)


for _order, (_name, _prefix) in POLY_MODELS.items():
    _n = _order + 1
    register_model(_name, POLYNOMIAL, make_poly(_order),
                   [f"{_prefix}{k}" for k in range(_n)], [0.0] * _n,
                   [-_INF] * _n, [_INF] * _n)
register_model("Proportional", POLYNOMIAL, proportional, ["A"], [1], [-_INF], [_INF])
register_model("Allometric1", POWER, allometric1, ["a", "b"], [1, 1], [-_INF] * 2, [_INF] * 2)
register_model("Sine", WAVEFORM, sine, ["xc", "w", "A", "y0"], [0, 1, 1, 0],
               [-_INF, 0, -_INF, -_INF], [_INF] * 4)
register_model("SineDamp", WAVEFORM, sine_damp, ["y0", "xc", "w", "t0", "A"], [0, 0, 1, 1, 1],
               [-_INF, -_INF, 0, 0, -_INF], [_INF] * 5)
