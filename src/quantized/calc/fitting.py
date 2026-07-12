"""Bounded nonlinear curve-fitting engine. Port of fitting.curveFit.

Pure calc layer. Mirrors MATLAB's toolbox-free approach: an unconstrained
Nelder-Mead optimizer (scipy ``minimize``, like ``fminsearch``) over a logit/log
*bound transform*, with parameter errors from a central-difference numerical
Hessian. Constraints/ParamNames are not yet supported (Lower/Upper/Weights/Fixed
are). Returns a result dict matching the MATLAB struct fields.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

__all__ = ["curve_fit"]

_EPS = float(np.finfo(float).eps)
ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def _bound_to_free(pb: float, lo: float, hi: float) -> float:
    if lo == -math.inf and hi == math.inf:
        return pb
    if lo > -math.inf and hi == math.inf:
        return math.log(pb - lo + _EPS)
    if lo == -math.inf and hi < math.inf:
        return -math.log(hi - pb + _EPS)
    t = (pb - lo) / (hi - lo)
    t = max(min(t, 1 - _EPS), _EPS)
    return math.log(t / (1 - t))


def _free_to_bound(pf: float, lo: float, hi: float) -> float:
    if lo == -math.inf and hi == math.inf:
        return pf
    if lo > -math.inf and hi == math.inf:
        return lo + math.exp(pf)
    if lo == -math.inf and hi < math.inf:
        return hi - math.exp(-pf)
    return lo + (hi - lo) / (1 + math.exp(-pf))


def _bound_jacobian(pf: float, lo: float, hi: float) -> float:
    if lo == -math.inf and hi == math.inf:
        return 1.0
    if lo > -math.inf and hi == math.inf:
        return math.exp(pf)
    if lo == -math.inf and hi < math.inf:
        return math.exp(-pf)
    s = 1 / (1 + math.exp(-pf))
    return (hi - lo) * s * (1 - s)


def _numerical_hessian(
    fun: Callable[[NDArray[np.float64]], float], x0: NDArray[np.float64]
) -> NDArray[np.float64]:
    n = x0.size
    hmat = np.zeros((n, n))
    f0 = fun(x0)
    h = np.maximum(np.abs(x0) * 1e-4, 1e-6)
    def perturb(signs: dict[int, int]) -> NDArray[np.float64]:
        v = x0.copy()
        for idx, sgn in signs.items():
            v[idx] += sgn * h[idx]
        return v

    for i in range(n):
        hmat[i, i] = (fun(perturb({i: 1})) - 2 * f0 + fun(perturb({i: -1}))) / h[i] ** 2
    for i in range(n):
        for j in range(i + 1, n):
            hmat[i, j] = (
                fun(perturb({i: 1, j: 1}))
                - fun(perturb({i: 1, j: -1}))
                - fun(perturb({i: -1, j: 1}))
                + fun(perturb({i: -1, j: -1}))
            ) / (4 * h[i] * h[j])
            hmat[j, i] = hmat[i, j]
    return hmat


def weights_from_dy(dy: ArrayLike, n: int) -> NDArray[np.float64]:
    """Per-point 1-sigma errors ``dy`` -> least-squares weights ``1/dy**2``.

    The single canonical error->weight convention shared by every fit entry
    point (``/fit``, ``/equation/fit``, ``/scan``) so "use the plotted error
    column" means the same thing everywhere. Validates length and that every
    entry is finite and strictly positive (a zero error would demand infinite
    weight).
    """
    dyv = np.asarray(dy, dtype=float).ravel()
    if dyv.size != n:
        raise ValueError("dy must have the same length as x")
    if not bool(np.all(np.isfinite(dyv))) or bool(np.any(dyv <= 0)):
        raise ValueError("dy entries must be finite and > 0")
    return np.asarray(1.0 / dyv**2, dtype=float)


def curve_fit(
    x: ArrayLike,
    y: ArrayLike,
    model_fcn: ModelFn,
    p0: Sequence[float],
    *,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    weights: ArrayLike | None = None,
    fixed: Sequence[bool] | None = None,
    max_iter: int | None = None,
    tol_fun: float = 1e-12,
    tol_x: float = 1e-10,
    calc_errors: bool = True,
) -> dict[str, Any]:
    """Bounded nonlinear least-squares fit. Port of fitting.curveFit.

    ``model_fcn(x, p) -> y``. Returns params/errors/covar/residuals/yFit plus
    R2/chiSqRed/RMSE/AIC and fit metadata.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    m = len(p0)
    n = xv.size
    lb = np.array(lower if lower is not None else [-math.inf] * m, dtype=float)
    ub = np.array(upper if upper is not None else [math.inf] * m, dtype=float)
    fixed_mask = np.array(fixed if fixed is not None else [False] * m, dtype=bool)
    w = np.asarray(weights, dtype=float).ravel() if weights is not None else np.ones(n)
    sqrt_w = np.sqrt(w)

    free_idx = [k for k in range(m) if not fixed_mask[k]]
    n_free = len(free_idx)
    max_iter = 5000 * max(n_free, 1) if max_iter is None else max_iter
    p0_arr: NDArray[np.float64] = np.asarray(
        np.clip(np.array(p0, dtype=float), lb, ub), dtype=float
    )

    def from_free(p_free: NDArray[np.float64]) -> NDArray[np.float64]:
        pb = p0_arr.copy()
        for j, k in enumerate(free_idx):
            pb[k] = _free_to_bound(float(p_free[j]), lb[k], ub[k])
        return pb

    def cost(p_free: NDArray[np.float64]) -> float:
        resid = (yv - model_fcn(xv, from_free(p_free))) * sqrt_w
        return float(np.sum(resid**2))

    p_free0 = np.array([_bound_to_free(p0_arr[k], lb[k], ub[k]) for k in free_idx])
    if n_free > 0:
        res = minimize(
            cost, p_free0, method="Nelder-Mead",
            options={"maxiter": max_iter, "maxfev": max_iter * 2, "xatol": tol_x, "fatol": tol_fun},
        )
        x_opt = np.asarray(res.x, dtype=float)
        exit_flag = 1 if res.success else 0
        n_iter = int(res.nit)
    else:
        x_opt = p_free0
        exit_flag, n_iter = 1, 0

    p_opt = from_free(x_opt)
    y_fit = np.asarray(model_fcn(xv, p_opt), dtype=float)
    residuals = yv - y_fit
    ss_res = float(np.sum(w * residuals**2))
    w_mean = float(np.sum(w * yv) / np.sum(w))
    ss_tot = float(np.sum(w * (yv - w_mean) ** 2))
    r2 = 1 - ss_res / max(ss_tot, _EPS)
    dof = n - n_free
    chi_sq_red = ss_res / max(dof, 1)
    rmse = math.sqrt(ss_res / n)
    # AIC via the Gaussian-error log-likelihood. A perfect fit (ss_res == 0)
    # gives log(0); MATLAB returns -Inf there (-> logLik +Inf, AIC -Inf), but
    # Python's math.log raises. Guard to preserve MATLAB's intent exactly.
    log_lik = (
        -n / 2 * math.log(2 * math.pi * ss_res / n) - n / 2
        if ss_res > 0
        else math.inf
    )
    aic = 2 * n_free - 2 * log_lik

    errors = np.full(m, np.nan)
    covar: NDArray[np.float64] | None = None
    if calc_errors and n_free > 0 and dof > 0:
        hess = _numerical_hessian(cost, x_opt)
        try:
            cov_free = np.asarray(np.linalg.inv(hess / 2) * chi_sq_red, dtype=float)
            if np.all(np.diag(cov_free) >= 0):
                se_free = np.sqrt(np.diag(cov_free))
                jac = np.array([_bound_jacobian(float(x_opt[k]), lb[free_idx[k]], ub[free_idx[k]])
                                for k in range(n_free)])
                for k in range(n_free):
                    errors[free_idx[k]] = se_free[k] * abs(jac[k])
                jmat = np.diag(jac)
                cov_bound = jmat @ cov_free @ jmat.T
                covar = np.zeros((m, m))
                covar[np.ix_(free_idx, free_idx)] = cov_bound
        except np.linalg.LinAlgError:
            pass

    return {
        "params": p_opt,
        "errors": errors,
        "covar": covar,
        "residuals": residuals,
        "yFit": y_fit,
        "R2": r2,
        "chiSqRed": chi_sq_red,
        "RMSE": rmse,
        "AIC": aic,
        "exitFlag": exit_flag,
        "nIter": n_iter,
        "nFree": n_free,
        "nPoints": n,
    }
