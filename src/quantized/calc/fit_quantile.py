"""Quantile regression for linear / polynomial models (GAP_AUDIT_9 G11).

Pure calc layer. Minimises the check loss ``sum rho_tau(y - X b)`` with
``rho_tau(u) = u (tau - [u<0])`` (Koenker & Bassett 1978, *Econometrica* 46,
33-50) as a linear program solved by scipy's HiGHS (``linprog``):

    min  tau 1'u + (1 - tau) 1'v   s.t.  X b + u - v = y,  u, v >= 0,  b free.

Standard errors are the heteroskedasticity-robust Powell sandwich
``(X'X)^-1 X' D X (X'X)^-1`` with ``D_i = (tau/f0)^2`` for a positive residual
and ``((1-tau)/f0)^2`` otherwise, where ``f0`` is the Epanechnikov-kernel
density of the residuals at zero with the Hall-Sheather (1988) bandwidth and
the Stata-12 scale ``min(sd(y), IQR(e)/1.34)``; this is the default of
``statsmodels.regression.quantile_regression.QuantReg`` (the test oracle).
``pseudoR2`` is Koenker & Machado (1999): ``1 - V1/V0`` against the
intercept-only tau-quantile fit.

Caveat: at a vertex solution p residuals are exactly zero and the sandwich
needs their sign. Here a zero residual takes the ``(1-tau)`` branch; the
statsmodels IRLS solution has tiny residuals of arbitrary sign, so standard
errors agree with it at tau = 0.5 and typically at tau < 0.5 but can differ
at other tau (coefficients always agree). Provisional, owner to confirm.

The solution of a quantile LP can be non-unique when the data are discrete;
HiGHS returns one vertex, statsmodels' IRLS an approximate one. The objective
values agree; coefficients agree to the tolerance in the tests when the
solution is unique.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import linprog
from scipy.sparse import csr_matrix, hstack, identity
from scipy.stats import norm

from quantized.calc.fit_robust import clean_xy, poly_design

__all__ = ["quantile_fit"]


def _check_loss(u: NDArray[np.float64], tau: float) -> float:
    return float(np.sum(u * (tau - (u < 0))))


def _solve(X: NDArray[np.float64], y: NDArray[np.float64], tau: float) -> NDArray[np.float64]:
    n, p = X.shape
    eye = identity(n, format="csr")
    a_eq = hstack([csr_matrix(X), eye, -eye], format="csr")
    cost = np.concatenate([np.zeros(p), np.full(n, tau), np.full(n, 1.0 - tau)])
    bounds = [(None, None)] * p + [(0, None)] * (2 * n)
    res = linprog(cost, A_eq=a_eq, b_eq=y, bounds=bounds, method="highs")
    if not res.success:
        raise ValueError(f"quantile regression did not converge: {res.message}")
    return np.asarray(res.x[:p], dtype=float)


def _epanechnikov(u: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(np.where(np.abs(u) <= 1.0, 0.75 * (1.0 - u**2), 0.0), dtype=float)


def _hall_sheather(n: int, tau: float, alpha: float = 0.05) -> float:
    z = float(norm.ppf(tau))
    num = 1.5 * float(norm.pdf(z)) ** 2
    cube = (num / (2 * z**2 + 1)) ** (1 / 3)
    return float(n ** (-1 / 3) * norm.ppf(1 - alpha / 2) ** (2 / 3) * cube)


def quantile_fit(x: ArrayLike, y: ArrayLike, tau: float = 0.5, degree: int = 1) -> dict[str, Any]:
    """Polynomial quantile regression of ``y`` on ``x`` at quantile ``tau``.

    ``tau`` must lie strictly in (0, 1); there is no recommended default beyond
    the median 0.5 (provisional, owner to confirm). Coefficients come lowest
    power first. Refuses a rank-deficient design.
    """
    if not (isinstance(tau, (int, float)) and 0.0 < tau < 1.0):
        raise ValueError("tau must be strictly between 0 and 1")
    xv, yv = clean_xy(x, y)
    X = poly_design(xv, degree)
    n, p = X.shape
    if n <= p:
        raise ValueError(f"need more points than coefficients (n={n}, coefficients={p})")
    if np.linalg.matrix_rank(X) < p:
        raise ValueError("design is rank deficient (too few distinct x values for this degree)")
    tau = float(tau)
    beta = _solve(X, yv, tau)
    e = yv - X @ beta
    iqr = float(np.percentile(e, 75) - np.percentile(e, 25))
    bw = _hall_sheather(n, tau)
    h = min(float(np.std(yv)), iqr / 1.34) * float(norm.ppf(tau + bw) - norm.ppf(tau - bw))
    errs: NDArray[np.float64] = np.full(p, np.nan)
    if h > 0 and math.isfinite(h):
        f0 = float(np.sum(_epanechnikov(e / h)) / (n * h))
        if f0 > 0:
            d = np.where(e > 0, (tau / f0) ** 2, ((1 - tau) / f0) ** 2)
            xtxi = np.linalg.pinv(X.T @ X)
            errs = np.asarray(np.sqrt(np.diag(xtxi @ ((X.T * d) @ X) @ xtxi)), dtype=float)
    v1 = _check_loss(e, tau)
    v0 = _check_loss(yv - np.quantile(yv, tau), tau)
    return {
        "coefficients": beta,
        "errors": errs,
        "yFit": X @ beta,
        "residuals": e,
        "tau": tau,
        "degree": int(degree),
        "checkLoss": v1,
        "pseudoR2": (1.0 - v1 / v0) if v0 > 0 else float("nan"),
        "nPoints": n,
    }
