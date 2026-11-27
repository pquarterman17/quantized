"""Origin built-in **Power** functions (category "Power").

Pure calc layer, imported for its registration side effects. Names, parameter
order and default bounds follow the Origin installation's function library;
only formulas and parameter names are recorded. Declared with
``fit_models_origin_dsl.define``.

Notes
-----
* ``Freundlich3PMod`` lists its parameters as ``a, b, k`` while its formula is
  written with ``c``; the parameter list is what a fit table shows, so the
  registry uses ``a, b, k`` with ``y = a + b*x^(1/k)``.
* ``Power2`` is a piecewise power law about ``xc`` with separate exponents
  below (``pl``) and above (``pu``); it is 0 at ``x == xc``.
* Origin's ``Allometric1`` is in ``fit_models_origin_misc``.
* Forms with the unknown inside a power of a sum (``(a + b*x^f)^(-1/c)``) get
  a start by scanning the exponents and regressing ``y^(-c)`` on ``[1, x^f]``.
"""

from __future__ import annotations

import itertools
from collections.abc import Callable, Sequence

import numpy as np
from numpy.typing import NDArray

from .fit_models_origin_dsl import define
from .fit_models_origin_rational import _g_gunary

FloatArray = NDArray[np.float64]
POWER = "Power"
_EXPONENTS = (0.25, 0.5, 1.0, 1.5, 2.0, 3.0, -0.5, -1.0, -2.0)


Formula = Callable[..., FloatArray]


def _scan(
    fn: Formula, x: FloatArray, y: FloatArray, grids: Sequence[Sequence[float]],
    build: Callable[..., list[float] | None],
) -> list[float] | None:
    """Best (by y-space SSR) parameter list ``build(*point)`` over the grid points."""
    best: tuple[float, list[float]] | None = None
    for point in itertools.product(*grids):
        with np.errstate(all="ignore"):
            p = build(*point)
            if p is None:
                continue
            ssr = float(np.sum((fn(x, *p) - y) ** 2))
        if np.isfinite(ssr) and (best is None or ssr < best[0]):
            best = (ssr, p)
    return None if best is None else best[1]


def _bl_neld_smp(x, a, b, c):  # type: ignore[no-untyped-def]
    return (a + b * x) ** (-1 / c)


def _bl_neld(x, a, b, c, f):  # type: ignore[no-untyped-def]
    return (a + b * x**f) ** (-1 / c)


def _harris(x, a, b, c):  # type: ignore[no-untyped-def]
    return 1 / (a + b * x**c)


Guess = Callable[[FloatArray, FloatArray], list[float] | None]


def _inverse_power(fn: Formula, kind: str) -> Guess:
    """Guess for ``(a + b*x^f)^(-1/c)`` families (kind: simple | full | harris)."""

    def guess(x: FloatArray, y: FloatArray) -> list[float] | None:
        keep = (x > 0) & (y > 0)
        if int(keep.sum()) < 6:
            return None
        xs, ys = x[keep], y[keep]

        def reg(c: float, basis: FloatArray) -> list[float]:
            a = np.column_stack([np.ones_like(xs), basis])
            coef, *_ = np.linalg.lstsq(a, ys ** (-c), rcond=None)
            return [float(coef[0]), float(coef[1])]

        if kind == "simple":  # (a + b x)^(-1/c)
            return _scan(fn, xs, ys, [_EXPONENTS], lambda c: [*reg(c, xs), c])
        if kind == "harris":  # (a + b x^c)^(-1)
            return _scan(fn, xs, ys, [_EXPONENTS], lambda f: [*reg(1.0, xs**f), f])
        return _scan(fn, xs, ys, [_EXPONENTS, _EXPONENTS],  # (a + b x^f)^(-1/c)
                     lambda c, f: [*reg(c, xs**f), c, f])

    return guess


def _langext2(x, a, b, c):  # type: ignore[no-untyped-def]
    return 1 / (a + b * x ** (c - 1))


def _g_langext2(x: FloatArray, y: FloatArray) -> list[float] | None:
    """1/(a + b*x^(c-1)): scan c, regress 1/y on [1, x^(c-1)]."""
    keep = (x > 0) & (np.abs(y) > 1e-12)
    if int(keep.sum()) < 6:
        return None
    xs, ys = x[keep], y[keep]

    def build(c: float) -> list[float]:
        a = np.column_stack([np.ones_like(xs), xs ** (c - 1)])
        coef, *_ = np.linalg.lstsq(a, 1.0 / ys, rcond=None)
        return [float(coef[0]), float(coef[1]), c]

    return _scan(_langext2, xs, ys, [(0.0, 0.25, 0.5, 1.5, 2.0, 3.0, 4.0)], build)


define("Power", POWER, "A", lambda x, a: x**a, kinds="A=e", positive_x=True)
define("Freundlich", POWER, "a,b", lambda x, a, b: a * x**b, lin="a", kinds="b=e", positive_x=True)
define("FreundlichMod1", POWER, "a,b", lambda x, a, b: a * x ** (1 / b),
       lin="a", kinds="b=e", positive_x=True)
define("Freundlich3P", POWER, "a,b,c", lambda x, a, b, c: a + b * x**c,
       lin="a,b", kinds="c=e", positive_x=True)
define("Freundlich3PMod", POWER, "a,b,k", lambda x, a, b, k: a + b * x ** (1 / k),
       lin="a,b", kinds="k=e", positive_x=True)
define("FreundlichEXT", POWER, "a,b,c", lambda x, a, b, c: a * x ** (b * x ** (-c)),
       lin="a", kinds="b=e c=e", positive_x=True)
define("Belehradek", POWER, "a,b,c", lambda x, a, b, c: a * (x - b) ** c,
       lin="a", kinds="b=below c=ep")
define("Pow2P1", POWER, "a,b", lambda x, a, b: a * (1 - x ** (-b)),
       lin="a", kinds="b=e", positive_x=True)
define("Pow2P2", POWER, "a,b", lambda x, a, b: a * (1 + x) ** b, lin="a", kinds="b=e")
define("Pow2P3", POWER, "a,b", lambda x, a, b: 1 - 1 / (1 + a * x) ** b, kinds="a=kp b=ep")
define("Pareto", POWER, "A", lambda x, a: 1 - 1 / x**a, kinds="A=ep", positive_x=True)
define("Pareto2", POWER, "a,b", lambda x, a, b: 1 - (b / x) ** a, kinds="a=ep b=w",
       positive_x=True)
define("Power0", POWER, "y0,xc,A,P", lambda x, y0, xc, a, p: y0 + a * np.abs(x - xc) ** p,
       lin="y0,A", kinds="xc=xe P=ep", lb={"A": 0.0})
define("Power1", POWER, "xc,A,P", lambda x, xc, a, p: a * np.abs(x - xc) ** p,
       lin="A", kinds="xc=xe P=ep", lb={"A": 0.0, "P": 0.0})
define("Power2", POWER, "xc,A,pl,pu",
       lambda x, xc, a, pl, pu: np.where(
           x < xc, a * np.abs(x - xc) ** pl, np.where(x > xc, a * np.abs(x - xc) ** pu, 0.0)),
       lin="A", kinds="xc=x pl=ep pu=ep", lb={"A": 0.0, "pl": 0.0, "pu": 0.0})
define("LangmuirEXT1", POWER, "a,b,c",
       lambda x, a, b, c: a * b * x ** (1 - c) / (1 + b * x ** (1 - c)),
       lin="a", kinds="b=bp c=e", positive_x=True)
define("LangmuirEXT2", POWER, "a,b,c", _langext2, guess=_g_langext2)
define("Gunary", POWER, "a,b,c", lambda x, a, b, c: x / (a + b * x + c * np.sqrt(x)),
       guess=_g_gunary)
define("BlNeldSmp", POWER, "a,b,c", _bl_neld_smp, guess=_inverse_power(_bl_neld_smp, "simple"))
define("BlNeld", POWER, "a,b,c,f", _bl_neld, guess=_inverse_power(_bl_neld, "full"))
define("FarazdaghiHarris", POWER, "a,b,c", _harris, guess=_inverse_power(_harris, "harris"))
define("Allometric2", POWER, "a,b,c", lambda x, a, b, c: a + b * x**c,
       lin="a,b", kinds="c=e", positive_x=True)
