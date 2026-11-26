"""Probability-distribution functions of the worksheet formula language, headless.

The Python twin of ``frontend/src/lib/formulaDist.ts``: every name below is
evaluated by the app and, through ``column_formula.py``, by an exported script,
with the same argument order and parameterisation (Origin's):

* ``normpdf(x, mu, sigma)``, ``normcdf(x[, tail])``, ``norminv(p)`` (the cdf and
  quantile are the STANDARD normal, as in Origin);
* ``tpdf/tcdf/tinv`` (df), ``chi2pdf/chi2cdf/chi2inv`` (df),
  ``fpdf/fcdf/finv`` (df1, df2);
* ``gampdf/gamcdf/gaminv(.., a, b)`` shape ``a``, scale ``b``;
  ``betapdf/betacdf/betainv(.., a, b)``;
* ``lognpdf/logncdf/logninv(.., mu, sigma)`` with mu, sigma of ``ln x``;
* ``wblpdf/wblcdf/wblinv(.., a, b)`` scale ``a``, shape ``b``;
* ``exppdf/expcdf/expinv(.., lambda)`` rate ``lambda``;
* ``poisspdf/poisscdf(k, lambda)``, ``binopdf/binocdf(k, n, p)``.

``tail`` (cdfs that take one): 2 = lower (default), 1 = upper; any other value,
including Origin's 0, is a row the app rejects, so here that row is NaN. A
missing argument is NaN and extra arguments are ignored, as in the app.
Out-of-domain parameters give NaN (scipy's convention, the app's too).

scipy.stats (BSD) is the implementation; the TypeScript side has its own
numerics, and ``tests/test_column_formula_dist.py`` plus
``lib/formulaDist.test.ts`` pin the two to one fixture grid.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray
from scipy import special, stats

Vec = NDArray[np.float64]
Pair = tuple[Vec, Vec]
_NAN = np.asarray(np.nan)

__all__ = ["DIST_FUNCS"]


def _f(v: object) -> Vec:
    return np.asarray(v, dtype=float)


def _plain(nreq: int, f: Callable[..., object]) -> Callable[..., Vec]:
    def call(*args: Vec) -> Vec:
        if len(args) < nreq:
            return _NAN
        with np.errstate(all="ignore"):
            return _f(f(*args[:nreq]))

    return call


def _tailed(nreq: int, pair: Callable[..., Pair], *, tail: bool = True) -> Callable[..., Vec]:
    """A cdf from ``pair(*args) -> (lower, upper)``; ``tail`` allows the optional
    trailing tail argument."""

    def call(*args: Vec) -> Vec:
        if len(args) < nreq:
            return _NAN
        with np.errstate(all="ignore"):
            lo, up = pair(*args[:nreq])
            if not tail or len(args) == nreq:
                return _f(lo)
            t = args[nreq]
            return _f(np.where(t == 2, lo, np.where(t == 1, up, np.nan)))

    return call


def _of(
    dist: Callable[..., stats.rv_continuous],
) -> tuple[Callable[..., Vec], Callable[..., Pair], Callable[..., Vec]]:
    """(pdf, pair, ppf) for a frozen-distribution factory ``dist(*params)``."""

    def pdf(x: Vec, *p: Vec) -> Vec:
        return _f(dist(*p).pdf(x))

    def pair(x: Vec, *p: Vec) -> Pair:
        d = dist(*p)
        return _f(d.cdf(x)), _f(d.sf(x))

    def ppf(q: Vec, *p: Vec) -> Vec:
        return _f(dist(*p).ppf(q))

    return pdf, pair, ppf


def _normal_pair(z: Vec) -> Pair:
    return _f(stats.norm.cdf(z)), _f(stats.norm.sf(z))


def _logn_z(x: Vec, mu: Vec, s: Vec) -> Vec:
    return _f((np.log(np.where(x > 0, x, 1.0)) - mu) / s)


def _logn_pdf(x: Vec, mu: Vec, s: Vec) -> Vec:
    safe = np.where(x > 0, x, 1.0)
    out = stats.norm.pdf(_logn_z(x, mu, s)) / (safe * s)
    return _f(np.where(s > 0, np.where(x > 0, out, 0.0), np.nan))


def _logn_pair(x: Vec, mu: Vec, s: Vec) -> Pair:
    lo, up = _normal_pair(_logn_z(x, mu, s))
    pos = x > 0
    ok = s > 0
    return (
        _f(np.where(ok, np.where(pos, lo, 0.0), np.nan)),
        _f(np.where(ok, np.where(pos, up, 1.0), np.nan)),
    )


def _logn_inv(p: Vec, mu: Vec, s: Vec) -> Vec:
    return _f(np.where(s > 0, np.exp(mu + s * stats.norm.ppf(p)), np.nan))


def _exp_dist(lam: Vec) -> stats.rv_continuous:
    with np.errstate(all="ignore"):
        scale = np.where(lam > 0, 1.0 / lam, np.nan)
    return stats.expon(scale=scale)


def _pois_pair(k: Vec, lam: Vec) -> Pair:
    kf = np.floor(k)
    return _f(stats.poisson.cdf(kf, lam)), _f(stats.poisson.sf(kf, lam))


def _bino_pair(k: Vec, n: Vec, p: Vec) -> Pair:
    kf = np.floor(k)
    return _f(stats.binom.cdf(kf, n, p)), _f(stats.binom.sf(kf, n, p))


def _beta_inv(q: Vec, a: Vec, b: Vec) -> Vec:
    # special.betaincinv, not stats.beta.ppf: the latter's root finder gives up
    # (and answers 1.96e-25 for 2.84e-21) at tiny p.
    ok = (a > 0) & (b > 0) & (q >= 0) & (q <= 1)
    return _f(np.where(ok, special.betaincinv(a, b, q), np.nan))


_n_pdf, _n_pair, _n_inv = _of(lambda mu, s: stats.norm(mu, s))
_t_pdf, _t_pair, _t_inv = _of(lambda df: stats.t(df))
_c_pdf, _c_pair, _c_inv = _of(lambda df: stats.chi2(df))
_f_pdf, _f_pair, _f_inv = _of(lambda a, b: stats.f(a, b))
_g_pdf, _g_pair, _g_inv = _of(lambda a, b: stats.gamma(a, scale=b))
_b_pdf, _b_pair, _b_inv = _of(lambda a, b: stats.beta(a, b))
_w_pdf, _w_pair, _w_inv = _of(lambda a, b: stats.weibull_min(b, scale=a))
_e_pdf, _e_pair, _e_inv = _of(_exp_dist)

DIST_FUNCS: dict[str, Callable[..., Vec]] = {
    "normpdf": _plain(3, _n_pdf),
    "normcdf": _tailed(1, lambda x: _normal_pair(x)),
    "norminv": _plain(1, stats.norm.ppf),
    "tpdf": _plain(2, _t_pdf),
    "tcdf": _tailed(2, _t_pair),
    "tinv": _plain(2, _t_inv),
    "chi2pdf": _plain(2, _c_pdf),
    "chi2cdf": _tailed(2, _c_pair),
    "chi2inv": _plain(2, _c_inv),
    "fpdf": _plain(3, _f_pdf),
    "fcdf": _tailed(3, _f_pair),
    "finv": _plain(3, _f_inv),
    "gampdf": _plain(3, _g_pdf),
    "gamcdf": _tailed(3, _g_pair),
    "gaminv": _plain(3, _g_inv),
    "betapdf": _plain(3, _b_pdf),
    "betacdf": _tailed(3, _b_pair),
    "betainv": _plain(3, _beta_inv),
    "lognpdf": _plain(3, _logn_pdf),
    "logncdf": _tailed(3, _logn_pair),
    "logninv": _plain(3, _logn_inv),
    "wblpdf": _plain(3, _w_pdf),
    "wblcdf": _tailed(3, _w_pair),
    "wblinv": _plain(3, _w_inv),
    "exppdf": _plain(2, _e_pdf),
    "expcdf": _tailed(2, _e_pair),
    "expinv": _plain(2, _e_inv),
    "poisspdf": _plain(2, lambda k, lam: stats.poisson.pmf(k, lam)),
    "poisscdf": _tailed(2, _pois_pair, tail=False),
    "binopdf": _plain(3, lambda k, n, p: stats.binom.pmf(k, n, p)),
    "binocdf": _tailed(3, _bino_pair, tail=False),
}
