"""Origin built-in **Exponential** functions for the curve-fit registry.

Pure calc layer, imported for its registration side effects (see the bottom of
``fit_models``). Names, parameter order and formulas follow OriginLab's
built-in library (category "Exponential"):

==========  ==================================================  ==================
Origin      formula                                             params
==========  ==================================================  ==================
ExpDec1     y0 + A1*exp(-x/t1)                                  y0 A1 t1
ExpDec2     y0 + A1*exp(-x/t1) + A2*exp(-x/t2)                  y0 A1 t1 A2 t2
ExpDec3     y0 + sum_i Ai*exp(-x/ti), i = 1..3                  y0 A1 t1 A2 t2 A3 t3
ExpDecay1   y0 + A1*exp(-(x-x0)/t1)                             y0 x0 A1 t1
ExpDecay2   y0 + sum_i Ai*exp(-(x-x0)/ti), i = 1..2             y0 x0 A1 t1 A2 t2
ExpDecay3   y0 + sum_i Ai*exp(-(x-x0)/ti), i = 1..3             y0 x0 A1 t1 ... A3 t3
ExpGro1     y0 + A1*exp(x/t1)                                   y0 A1 t1
ExpGro2     y0 + A1*exp(x/t1) + A2*exp(x/t2)                    y0 A1 t1 A2 t2
ExpGrow1    y0 + A1*exp((x-x0)/t1)                              y0 x0 A1 t1
ExpGrow2    y0 + sum_i Ai*exp((x-x0)/ti), i = 1..2              y0 x0 A1 t1 A2 t2
==========  ==================================================  ==================

In the ``x0`` variants ``x0`` and the amplitudes are not independent
(``Ai*exp(x0/ti)`` is all the data can determine). Origin users normally FIX
``x0`` at the start of the decay; the auto-guess sets it to min(x), and the
fitted curve is well defined either way.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from .fit_models import register_model

FloatArray = NDArray[np.float64]
ModelFn = Callable[[FloatArray, FloatArray], FloatArray]

_INF = float("inf")
EXPONENTIAL = "Exponential"


def make_exp_sum(n_terms: int, *, offset: bool, growth: bool) -> ModelFn:
    """Evaluator for ``y0 + sum Ai*exp(s*(x - x0)/ti)``; s = +1 growth, -1 decay.

    Parameter layout: (y0, [x0,] A1, t1, A2, t2, ...).
    """
    sgn = 1.0 if growth else -1.0
    first = 2 if offset else 1

    def fcn(x: FloatArray, p: FloatArray) -> FloatArray:
        x0 = np.float64(p[1]) if offset else 0.0
        out = np.full(x.shape, np.float64(p[0]), dtype=float)
        with np.errstate(over="ignore"):
            for i in range(n_terms):
                a, t = np.float64(p[first + 2 * i]), np.float64(p[first + 2 * i + 1])
                out = out + a * np.exp(sgn * (x - x0) / t)
        return np.asarray(out, dtype=float)

    kind = "growth" if growth else "decay"
    fcn.__doc__ = f"{n_terms}-term exponential {kind}{' with x0 offset' if offset else ''}."
    return fcn


def _register(name: str, n_terms: int, *, offset: bool, growth: bool) -> None:
    names = ["y0"] + (["x0"] if offset else [])
    p0: list[float] = [0.0] + ([0.0] if offset else [])
    lb = [-_INF] + ([-_INF] if offset else [])
    for i in range(1, n_terms + 1):
        names += [f"A{i}", f"t{i}"]
        p0 += [1.0, float(i)]
        lb += [-_INF, 0.0]
    register_model(name, EXPONENTIAL, make_exp_sum(n_terms, offset=offset, growth=growth),
                   names, p0, lb, [_INF] * len(names))


# name -> (n_terms, offset, growth); fit_autoguess_origin reads this table too.
EXP_FAMILY: dict[str, tuple[int, bool, bool]] = {
    "ExpDec1": (1, False, False),
    "ExpDec2": (2, False, False),
    "ExpDec3": (3, False, False),
    "ExpDecay1": (1, True, False),
    "ExpDecay2": (2, True, False),
    "ExpDecay3": (3, True, False),
    "ExpGro1": (1, False, True),
    "ExpGro2": (2, False, True),
    "ExpGrow1": (1, True, True),
    "ExpGrow2": (2, True, True),
}

for _name, (_n, _off, _gro) in EXP_FAMILY.items():
    _register(_name, _n, offset=_off, growth=_gro)
