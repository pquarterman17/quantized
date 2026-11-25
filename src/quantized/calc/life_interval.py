"""Interval- and left-censored life-distribution maximum likelihood (GAP_AUDIT_9 G8).

Rows are ``(lower, upper)`` bounds on the failure time, one row per unit:

- ``lower == upper``            : exact failure at that time
- ``0 <= lower < upper < inf``  : failed somewhere in (lower, upper] (interval-censored)
- ``lower == 0``                : failed before ``upper`` (left-censored; for the
  ln-time families this is exactly ``F(upper)``, since ``F(0) = 0``; for the
  smallest-extreme-value family on ``t`` the interval is the literal [0, upper])
- ``upper = inf`` (JSON null)   : survived past ``lower`` (right-censored)

Log-likelihood terms (location-scale, ``z = (g(t) - mu) / sigma``, ``S = 1 - G``):
exact ``ln g(z) - ln sigma [- ln t]``; otherwise ``ln(S(z_l) - S(z_u))``. The
``-ln t`` Jacobian of exact rows is kept for the log families, so the value is
comparable with ``life_core.fit_ml`` (and with AICc / BIC across families).
Intercept-only (one location, one scale); standard errors from a central
finite-difference Hessian of the log-likelihood.

Oracle: ``lifelines`` ``fit_interval_censoring`` (tests). Method: Meeker &
Escobar (1998) sec. 2.7 / 7.2; Lawless (2003) ch. 2. Provisional, owner to
confirm: lower = 0 reads as left-censored; refusals listed in ``check_interval_data``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import optimize

from quantized.calc.life_core import _STD, DISTRIBUTIONS, MLFit

__all__ = ["IntervalData", "check_interval_data", "fit_interval", "interval_loglik"]


@dataclass(frozen=True)
class IntervalData:
    lower: NDArray[np.float64]
    upper: NDArray[np.float64]  # inf = right-censored

    @property
    def n(self) -> int:
        return int(self.lower.size)

    @property
    def exact(self) -> NDArray[np.bool_]:
        return np.asarray(self.lower == self.upper, dtype=bool)

    @property
    def right(self) -> NDArray[np.bool_]:
        return np.asarray(np.isinf(self.upper), dtype=bool)

    @property
    def left(self) -> NDArray[np.bool_]:
        return np.asarray((self.lower == 0.0) & ~self.exact & ~self.right, dtype=bool)

    @property
    def n_events(self) -> int:
        """Rows that carry a finite upper bound (an exact, interval or left-censored failure)."""
        return int(np.isfinite(self.upper).sum())


def check_interval_data(lower: Any, upper: Any, *, log_time: bool = True) -> IntervalData:
    """Validate and pack; refuses (ValueError) rather than guessing.

    ``None`` / NaN upper = right-censored.
    """
    lo = np.asarray(lower, dtype=float).ravel()
    up = np.asarray(
        [np.inf if u is None else u for u in np.asarray(upper, dtype=object).ravel()], dtype=float
    )
    up = np.where(np.isnan(up), np.inf, up)
    if lo.size != up.size:
        raise ValueError(f"lower length {lo.size} != upper length {up.size}")
    if lo.size == 0:
        raise ValueError("no rows")
    if not np.all(np.isfinite(lo)):
        raise ValueError("lower bounds must be finite (use 0 for a left-censored row)")
    if np.any(np.isneginf(up)):
        raise ValueError("upper bounds must not be -inf")
    if np.any(lo < 0.0):
        raise ValueError("times must be non-negative")
    if np.any(lo > up):
        bad = int(np.nonzero(lo > up)[0][0]) + 1
        raise ValueError(f"lower > upper in row {bad}; every interval needs lower <= upper")
    if np.all(np.isinf(up)):
        raise ValueError(
            "every row is right-censored (no upper bound): there is no failure information to fit"
        )
    if np.any((lo == 0.0) & np.isinf(up)):
        raise ValueError("a row with lower = 0 and no upper bound carries no information; drop it")
    if log_time and np.any((lo == up) & (lo <= 0.0)):
        raise ValueError(
            "this distribution works on ln(time), so an exact failure time must be greater than 0"
        )
    if int(np.isfinite(up).sum()) < 2:
        raise ValueError("need at least 2 rows with a failure bound (finite upper) to fit")
    return IntervalData(lo, up)


def _logs(std: str, z: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(_STD[std](z)[2], dtype=float)  # log survival


def interval_loglik(data: IntervalData, dist: str, mu: float, s: float) -> float:
    """Log-likelihood in the t scale at location ``mu`` and ``s = ln sigma``."""
    std, log_time, fixed = DISTRIBUTIONS[dist]
    sigma = float(np.exp(0.0 if fixed else s))
    ex, rt = data.exact, data.right
    ll = 0.0
    with np.errstate(all="ignore"):
        if ex.any():
            t = data.lower[ex]
            y = np.log(t) if log_time else t
            logf = _STD[std]((y - mu) / sigma)[0]
            ll += float(np.sum(logf - np.log(sigma) - (y if log_time else 0.0)))
        rest = ~ex
        if rest.any():
            lo, up = data.lower[rest], data.upper[rest]
            ylo = np.log(np.where(lo > 0, lo, 1.0)) if log_time else lo
            zl = (ylo - mu) / sigma
            if log_time:
                zl = np.where(lo == 0.0, -np.inf, zl)
            sl = _logs(std, zl)
            yu = np.log(up) if log_time else up
            zu = (np.where(np.isinf(up), 0.0, yu) - mu) / sigma
            su = _logs(std, zu)
            d = np.minimum(su - sl, -1e-300)
            both = sl + np.log(np.maximum(-np.expm1(d), 1e-300))
            ll += float(np.sum(np.where(rt[rest], sl, both)))
    return ll if np.isfinite(ll) else -1e300


def _start(data: IntervalData, log_time: bool) -> tuple[float, float]:
    mid = np.where(np.isinf(data.upper), data.lower * 1.5 + 1e-9, 0.5 * (data.lower + data.upper))
    mid = np.where(data.lower == 0.0, 0.5 * np.where(np.isinf(data.upper), 1.0, data.upper), mid)
    y = np.log(np.maximum(mid, 1e-12)) if log_time else mid
    return float(np.mean(y)), float(np.log(max(float(np.std(y)), 1e-3)))


def _hessian(fun: Any, theta: NDArray[np.float64]) -> NDArray[np.float64]:
    k = theta.size
    h = 1e-3 * np.maximum(1.0, np.abs(theta))
    f0 = fun(theta)
    hess = np.empty((k, k))
    for i in range(k):
        for j in range(i, k):
            ei, ej = np.zeros(k), np.zeros(k)
            ei[i], ej[j] = h[i], h[j]
            if i == j:
                v = (fun(theta + ei) - 2.0 * f0 + fun(theta - ei)) / h[i] ** 2
            else:
                v = (
                    fun(theta + ei + ej)
                    - fun(theta + ei - ej)
                    - fun(theta - ei + ej)
                    + fun(theta - ei - ej)
                ) / (4.0 * h[i] * h[j])
            hess[i, j] = hess[j, i] = v
    return hess


def fit_interval(data: IntervalData, dist: str) -> MLFit:
    """Maximum-likelihood fit of an intercept-only life distribution to interval rows."""
    _, log_time, fixed = DISTRIBUTIONS[dist]
    mu0, s0 = _start(data, log_time)
    x0 = np.array([mu0] if fixed else [mu0, s0])

    def nll(th: NDArray[np.float64]) -> float:
        return -interval_loglik(data, dist, float(th[0]), 0.0 if fixed else float(th[1]))

    best = None
    for start in (x0, x0 if fixed else x0 + np.array([0.0, 1.0])):
        res = optimize.minimize(
            nll,
            start,
            method="Nelder-Mead",
            options={"xatol": 1e-10, "fatol": 1e-13, "maxiter": 5000, "maxfev": 10000},
        )
        res = optimize.minimize(nll, res.x, method="BFGS", options={"gtol": 1e-8})
        if best is None or res.fun < best.fun:
            best = res
    assert best is not None
    theta = np.asarray(best.x, dtype=float)
    if not np.isfinite(best.fun) or best.fun >= 1e299:
        raise ValueError(f"the {dist} likelihood did not converge; the data may not support it")
    hess = _hessian(nll, theta)
    try:
        cov_free = np.linalg.inv(hess)
        if np.any(np.diag(cov_free) <= 0) or np.any(np.linalg.eigvalsh(hess) <= 0):
            raise np.linalg.LinAlgError
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            f"the {dist} information matrix is singular (the intervals do not pin the "
            "parameters down, e.g. all failures fall inside one interval)"
        ) from exc
    cov = np.zeros((2, 2))
    cov[: theta.size, : theta.size] = cov_free
    return MLFit(
        dist,
        theta[:1].copy(),
        0.0 if fixed else float(theta[1]),
        cov,
        float(-best.fun),
        data.n,
        data.n_events,
        theta.size,
        True,
    )
