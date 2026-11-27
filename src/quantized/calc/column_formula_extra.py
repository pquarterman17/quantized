"""Special and engineering functions of the worksheet formula language, headless.

The Python twin of ``frontend/src/lib/formulaSpecialFns.ts`` and
``formulaEngineering.ts`` (plus the older ``erf``/``erfc``/``gamma``/``lgamma``
of ``formulaMath.ts``): every name below is evaluated by the app and, through
``column_formula.py``, by an exported script, with the same argument order and
domain rules. ``tests/test_column_formula_extra.py`` and
``lib/formulaWave2.test.ts`` replay one fixture against the two.

Arity as the other element-wise tables: a missing argument is NaN and extra
arguments are ignored. Out-of-domain arguments are NaN (``beta``/``lbeta`` continue
to negative arguments as scipy does; ``besselj``/``bessely``: whole order, ``|n| <= 500``;
``fact``/``combin``/``permut``/``gcd``/``lcm``: whole numbers).

scipy.special (BSD) is the implementation.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray
from scipy import special

Vec = NDArray[np.float64]
Mask = NDArray[np.bool_]
Ints = NDArray[np.int64]
_NAN = np.asarray(np.nan)
MAX_ORDER = 500

__all__ = ["EXTRA_FUNCS"]


def _f(v: object) -> Vec:
    return np.asarray(v, dtype=float)


def _fixed(nreq: int, f: Callable[..., object]) -> Callable[..., Vec]:
    def call(*args: Vec) -> Vec:
        if len(args) < nreq:
            return _NAN
        with np.errstate(all="ignore"):
            return _f(f(*args[:nreq]))

    return call


def _whole(v: Vec) -> Mask:
    return np.asarray(np.isfinite(v) & (v == np.floor(v)), dtype=bool)


def _nonneg_whole(v: Vec) -> Mask:
    return np.asarray(_whole(v) & (v >= 0), dtype=bool)


def _bessel(f: Callable[[Vec, Vec], Vec], *, positive_x: bool) -> Callable[[Vec, Vec], Vec]:
    def g(n: Vec, x: Vec) -> Vec:
        ok = _whole(n) & (np.abs(n) <= MAX_ORDER) & ~np.isnan(x)
        if positive_x:
            ok = ok & (x >= 0)
        return np.where(ok, f(np.where(ok, n, 0.0), np.where(ok, x, 1.0)), np.nan)

    return g


def _bessel_y(n: Vec, x: Vec) -> Vec:
    out = np.asarray(special.yv(n, x), dtype=float)
    return np.where(np.isposinf(x), 0.0, out)


def _bessel_j(n: Vec, x: Vec) -> Vec:
    out = np.asarray(special.jv(n, x), dtype=float)
    return np.where(np.isinf(x), 0.0, out)


def _mod(a: Vec, b: Vec) -> Vec:
    return np.where(b == 0, np.nan, np.mod(a, np.where(b == 0, 1.0, b)))


def _count(f: Callable[[Vec, Vec], Vec]) -> Callable[[Vec, Vec], Vec]:
    def g(n: Vec, k: Vec) -> Vec:
        ok = _nonneg_whole(n) & _nonneg_whole(k) & (k <= n)
        return np.where(ok, f(np.where(ok, n, 0.0), np.where(ok, k, 0.0)), np.nan)

    return g


def _int_pair(f: Callable[[Ints, Ints], Vec]) -> Callable[[Vec, Vec], Vec]:
    def g(a: Vec, b: Vec) -> Vec:
        ok = _nonneg_whole(a) & _nonneg_whole(b)
        ai = np.where(ok, a, 0.0).astype(np.int64)
        bi = np.where(ok, b, 0.0).astype(np.int64)
        return np.where(ok, f(ai, bi), np.nan)

    return g


def _lcm(a: Ints, b: Ints) -> Vec:  # whole-number arrays (int64)
    return np.where((a == 0) | (b == 0), 0.0, np.lcm(a, b).astype(float))


def _heaviside(*args: Vec) -> Vec:
    if not args:
        return _NAN
    h0 = args[1] if len(args) > 1 else np.asarray(0.5)
    with np.errstate(all="ignore"):
        return _f(np.heaviside(args[0], h0))


def _choose(*args: Vec) -> Vec:
    if len(args) < 2:
        return _NAN
    k = np.trunc(args[0])
    vals = np.broadcast_arrays(k, *args[1:])
    out = np.full(vals[0].shape, np.nan)
    for i, v in enumerate(vals[1:], start=1):
        out = np.where(vals[0] == i, v, out)
    return _f(out)


def _wrap(v: Vec, lo: Vec, hi: Vec) -> Vec:
    width = hi - lo
    return np.where(width > 0, lo + _mod(v - lo, np.where(width > 0, width, 1.0)), np.nan)


def _between(v: Vec, lo: Vec, hi: Vec) -> Vec:
    return np.where(np.isnan(v + lo + hi), np.nan, ((lo <= v) & (v <= hi)).astype(float))


EXTRA_FUNCS: dict[str, Callable[..., Vec]] = {
    # special functions
    "erf": _fixed(1, special.erf),
    "erfc": _fixed(1, special.erfc),
    "gamma": _fixed(1, special.gamma),
    "lgamma": _fixed(1, special.gammaln),
    "erfinv": _fixed(1, special.erfinv),
    "erfcinv": _fixed(1, special.erfcinv),
    "beta": _fixed(2, special.beta),
    "lbeta": _fixed(2, special.betaln),
    "digamma": _fixed(1, special.digamma),
    "besselj": _fixed(2, _bessel(_bessel_j, positive_x=False)),
    "bessely": _fixed(2, _bessel(_bessel_y, positive_x=True)),
    "sinc": _fixed(1, np.sinc),
    # engineering and data manipulation
    "clamp": _fixed(
        3, lambda v, lo, hi: np.where(lo > hi, np.nan, np.minimum(np.maximum(v, lo), hi))
    ),
    "heaviside": _heaviside,
    "todb": _fixed(1, lambda v: 20.0 * np.log10(v)),
    "fromdb": _fixed(1, lambda d: np.power(10.0, d / 20.0)),
    "degrees": _fixed(1, lambda r: r * (180.0 / np.pi)),
    "radians": _fixed(1, lambda d: d * (np.pi / 180.0)),
    "mod": _fixed(2, _mod),
    "trunc": _fixed(1, np.trunc),
    "fact": _fixed(
        1,
        lambda n: np.where(
            _nonneg_whole(n), special.gamma(np.where(_nonneg_whole(n), n, 0.0) + 1.0), np.nan
        ),
    ),
    "combin": _fixed(2, _count(lambda n, k: special.comb(n, k))),
    "permut": _fixed(2, _count(lambda n, k: special.perm(n, k))),
    "gcd": _fixed(2, _int_pair(lambda a, b: np.gcd(a, b).astype(float))),
    "lcm": _fixed(2, _int_pair(_lcm)),
    "isnan": _fixed(1, lambda v: np.isnan(v).astype(float)),
    "ifnan": _fixed(2, lambda v, alt: np.where(np.isnan(v), alt, v)),
    "between": _fixed(3, _between),
    "wrap": _fixed(3, _wrap),
    "choose": _choose,
    "cbrt": _fixed(1, np.cbrt),
    "expm1": _fixed(1, np.expm1),
    "log1p": _fixed(1, np.log1p),
}
