"""Origin built-in **Polynomial**, **Power** and **Waveform** functions.

Pure calc layer, imported for its registration side effects (see the bottom of
``fit_models``). Names, parameter order and formulas follow OriginLab's
built-in library:

* Polynomial — ``Poly 5`` .. ``Poly 9``: Origin's ``Poly`` (polynomial order up
  to 9), y = A0 + A1*x + ... + An*x^n with Origin's ascending ``A0..An``
  parameter names. (The MATLAB-parity ``Quadratic``/``Cubic``/``Poly 4`` keep
  their descending a, b, c... order and golden values.) ``Proportional``:
  Origin's line through the origin, y = A*x.
* Power — ``Allometric1``: y = a*x^b (Origin's form; x < 0 with a non-integer
  b is NaN, as in Origin — the MATLAB-parity ``Allometric`` uses |x|).
* Waveform — ``Sine``: y = y0 + A*sin(pi*(x-xc)/w) (w is the HALF period);
  ``SineDamp``: y = y0 + A*exp(-x/t0)*sin(pi*(x-xc)/w). Here ``A >= 0`` and
  ``w > 0`` are bounded so a fit is unique up to xc mod 2w (a negative A is
  the same curve shifted by half a period).
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

# Origin's polynomial fit stops at order 9.
POLY_ORDERS = range(5, 10)


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
    """Origin ``Proportional``: y = A*x (line through the origin). Params (A,)."""
    return np.asarray(np.float64(p[0]) * x, dtype=float)


def allometric1(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Allometric1``: y = a*x^b. Params (a, b)."""
    a, b = np.float64(p[0]), np.float64(p[1])
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        return np.asarray(a * np.power(x, b), dtype=float)


def sine(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``Sine``: y = y0 + A*sin(pi*(x-xc)/w). Params (y0, xc, w, A); period = 2w."""
    y0, xc, w, a = (np.float64(v) for v in p[:4])
    return np.asarray(y0 + a * np.sin(math.pi * (x - xc) / w), dtype=float)


def sine_damp(x: FloatArray, p: FloatArray) -> FloatArray:
    """Origin ``SineDamp``: y = y0 + A*exp(-x/t0)*sin(pi*(x-xc)/w). Params (y0, xc, w, t0, A)."""
    y0, xc, w, t0, a = (np.float64(v) for v in p[:5])
    with np.errstate(over="ignore", invalid="ignore"):
        env = np.exp(-x / t0)
        return np.asarray(y0 + a * env * np.sin(math.pi * (x - xc) / w), dtype=float)


for _order in POLY_ORDERS:
    _n = _order + 1
    register_model(f"Poly {_order}", POLYNOMIAL, make_poly(_order),
                   [f"A{k}" for k in range(_n)], [0.0] * _n,
                   [-_INF] * _n, [_INF] * _n)
register_model("Proportional", POLYNOMIAL, proportional, ["A"], [1], [-_INF], [_INF])
register_model("Allometric1", POWER, allometric1, ["a", "b"], [1, 1], [-_INF] * 2, [_INF] * 2)
register_model("Sine", WAVEFORM, sine, ["y0", "xc", "w", "A"], [0, 0, 1, 1],
               [-_INF, -_INF, 0, 0], [_INF] * 4)
register_model("SineDamp", WAVEFORM, sine_damp, ["y0", "xc", "w", "t0", "A"], [0, 0, 1, 1, 1],
               [-_INF, -_INF, 0, 0, 0], [_INF] * 5)
