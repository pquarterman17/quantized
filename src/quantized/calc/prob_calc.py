"""Probability calculator: pdf / pmf, cdf, survival and quantile of a distribution.

Pick a distribution and its parameters, then evaluate at one value or a whole
column. The distributions and parameter names are the worksheet formula
language's (``calc/column_formula_dist.py``, Origin's ``normpdf`` family), and
every value of those is computed THROUGH that function table, so a number from
this calculator equals the same formula typed into a column. ``formulas`` in the
result gives the equivalent formula strings (``A`` is the column holding x)
so the equality can be checked, and is tested to hold.

Parameters (names as the formula functions take them):

* normal(mu, sigma); lognormal(mu, sigma of ln x)
* t(df); chi2(df); f(df1, df2)
* gamma(a shape, b scale); beta(a, b); weibull(a scale, b shape)
* exponential(lambda rate); poisson(lambda); binomial(n, p)
* uniform(a, b): not a formula function, so scipy computes it directly.

The formula language has no quantile for the discrete distributions; here the
quantile of a Poisson or binomial is the smallest k whose cdf reaches p
(scipy's ``ppf``). Values outside a distribution's domain are NaN.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats

from quantized.calc.column_formula_dist import DIST_FUNCS

__all__ = ["DISTRIBUTIONS", "MAX_POINTS", "evaluate"]

Vec = NDArray[np.float64]
MAX_POINTS = 2_000_000


@dataclass(frozen=True)
class Dist:
    label: str
    params: tuple[str, ...]
    defaults: tuple[float, ...]
    discrete: bool
    valid: Callable[..., bool]
    prefix: (
        str | None
    )  # formula-function prefix (normpdf -> "norm"); None: not in the formula language


def _pos(*v: float) -> bool:
    return all(x > 0 for x in v)


DISTRIBUTIONS: dict[str, Dist] = {
    "normal": Dist("Normal", ("mu", "sigma"), (0.0, 1.0), False, lambda m, s: s > 0, "norm"),
    "t": Dist("Student t", ("df",), (10.0,), False, _pos, "t"),
    "chi2": Dist("Chi-square", ("df",), (3.0,), False, _pos, "chi2"),
    "f": Dist("F", ("df1", "df2"), (5.0, 10.0), False, _pos, "f"),
    "gamma": Dist("Gamma", ("a", "b"), (2.0, 1.0), False, _pos, "gam"),
    "beta": Dist("Beta", ("a", "b"), (2.0, 3.0), False, _pos, "beta"),
    "lognormal": Dist("Lognormal", ("mu", "sigma"), (0.0, 1.0), False, lambda m, s: s > 0, "logn"),
    "weibull": Dist("Weibull", ("a", "b"), (1.0, 1.5), False, _pos, "wbl"),
    "exponential": Dist("Exponential", ("lambda",), (1.0,), False, _pos, "exp"),
    "uniform": Dist("Uniform", ("a", "b"), (0.0, 1.0), False, lambda a, b: b > a, None),
    "poisson": Dist("Poisson", ("lambda",), (4.0,), True, _pos, "poiss"),
    "binomial": Dist(
        "Binomial",
        ("n", "p"),
        (10.0, 0.5),
        True,
        lambda n, p: n >= 0 and n == int(n) and 0 <= p <= 1,
        "bino",
    ),
}


def _vec(values: Sequence[float | None]) -> Vec:
    return np.asarray([math.nan if v is None else v for v in values], dtype=float)


def _frozen(dist: str, p: tuple[float, ...]) -> Any:
    """scipy's frozen distribution, for the pieces the formula table has no function for."""
    if dist == "uniform":
        return stats.uniform(p[0], p[1] - p[0])
    if dist == "poisson":
        return stats.poisson(p[0])
    return stats.binom(int(p[0]), p[1])


def _call(name: str, *args: Vec | float) -> Vec:
    return np.asarray(DIST_FUNCS[name](*[np.asarray(a, dtype=float) for a in args]), dtype=float)


def _pdf(dist: str, p: tuple[float, ...], x: Vec) -> Vec:
    d = DISTRIBUTIONS[dist]
    if d.prefix is None:
        return np.asarray(_frozen(dist, p).pdf(x), dtype=float)
    return _call(f"{d.prefix}pdf", x, *p) if dist != "normal" else _call("normpdf", x, *p)


def _cdf_sf(dist: str, p: tuple[float, ...], x: Vec) -> tuple[Vec, Vec]:
    d = DISTRIBUTIONS[dist]
    if d.prefix is None or d.discrete:
        fz = _frozen(dist, p)
        k = np.floor(x) if d.discrete else x
        with np.errstate(all="ignore"):
            return np.asarray(fz.cdf(k), dtype=float), np.asarray(fz.sf(k), dtype=float)
    if dist == "normal":
        z = (x - p[0]) / p[1]
        return _call("normcdf", z), _call("normcdf", z, 1.0)
    name = f"{d.prefix}cdf"
    return _call(name, x, *p), _call(name, x, *p, 1.0)


def _quantile(dist: str, p: tuple[float, ...], q: Vec) -> Vec:
    d = DISTRIBUTIONS[dist]
    if d.prefix is None or d.discrete:
        with np.errstate(all="ignore"):
            return np.asarray(_frozen(dist, p).ppf(q), dtype=float)
    if dist == "normal":
        return np.asarray(p[0] + p[1] * _call("norminv", q), dtype=float)
    return _call(f"{d.prefix}inv", q, *p)


def _num(v: float) -> str:
    return repr(int(v)) if v == int(v) and abs(v) < 1e15 else repr(float(v))


def _formulas(dist: str, p: tuple[float, ...]) -> dict[str, str | None]:
    """The worksheet formulas that give the same values (``A`` is the x column)."""
    d = DISTRIBUTIONS[dist]
    if d.prefix is None:
        return {"pdf": None, "cdf": None, "sf": None, "quantile": None}
    a = ", ".join(_num(v) for v in p)
    pre = d.prefix
    if dist == "normal":
        z = f"(A - {_num(p[0])}) / {_num(p[1])}"
        return {
            "pdf": f"normpdf(A, {a})",
            "cdf": f"normcdf({z})",
            "sf": f"normcdf({z}, 1)",
            "quantile": f"{_num(p[0])} + {_num(p[1])} * norminv(A)",
        }
    return {
        "pdf": f"{pre}pdf(A, {a})",
        "cdf": f"{pre}cdf(A, {a})",
        "sf": None if d.discrete else f"{pre}cdf(A, {a}, 1)",
        "quantile": None if d.discrete else f"{pre}inv(A, {a})",
    }


def evaluate(
    dist: str,
    params: dict[str, float],
    x: Sequence[float | None] | None = None,
    p: Sequence[float | None] | None = None,
) -> dict[str, Any]:
    """Evaluate ``dist`` at ``x`` (pdf/pmf, cdf, survival) and/or ``p`` (quantile)."""
    if dist not in DISTRIBUTIONS:
        raise ValueError(f"dist must be one of {sorted(DISTRIBUTIONS)}, got {dist!r}")
    d = DISTRIBUTIONS[dist]
    missing = [name for name in d.params if name not in params]
    if missing:
        raise ValueError(f"missing parameter(s) for {d.label}: {', '.join(missing)}")
    values = tuple(float(params[name]) for name in d.params)
    if not all(math.isfinite(v) for v in values) or not d.valid(*values):
        raise ValueError(
            f"invalid parameters for {d.label}: {dict(zip(d.params, values, strict=True))}"
        )
    if x is None and p is None:
        raise ValueError("give x values, probabilities p, or both")
    if max(len(x or ()), len(p or ())) > MAX_POINTS:
        raise ValueError(f"too many values (limit {MAX_POINTS})")
    out: dict[str, Any] = {
        "dist": dist,
        "label": d.label,
        "params": dict(zip(d.params, values, strict=True)),
        "discrete": d.discrete,
        "formulas": _formulas(dist, values),
    }
    if x is not None:
        xv = _vec(x)
        cdf, sf = _cdf_sf(dist, values, xv)
        blank = np.isnan(xv)  # a blank cell stays blank whatever the function does with NaN
        out.update(
            x=xv,
            pdf=np.where(blank, np.nan, _pdf(dist, values, xv)),
            cdf=np.where(blank, np.nan, cdf),
            sf=np.where(blank, np.nan, sf),
        )
    if p is not None:
        pv = _vec(p)
        bad = (pv < 0) | (pv > 1)
        q = _quantile(dist, values, np.where(bad, np.nan, pv))
        out.update(p=pv, quantile=np.where(bad, np.nan, q))
    return out
