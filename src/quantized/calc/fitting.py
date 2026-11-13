"""Bounded nonlinear curve-fitting engine. Port of fitting.curveFit.

Pure calc layer. Mirrors MATLAB's toolbox-free approach: an unconstrained
Nelder-Mead optimizer (scipy ``minimize``, like ``fminsearch``) over a logit/log
*bound transform*, with parameter errors from a central-difference numerical
Hessian (or, by default, the Gauss-Newton ``(JᵀWJ)⁻¹`` -- ``calc.fit_covariance``).
Constraints/ParamNames are not yet supported (Lower/Upper/Weights/Fixed are).
Returns a result dict with the MATLAB struct fields plus the extras documented
on ``curve_fit``.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

from .fit_covariance import (
    COVARIANCE_METHODS,
    hessian_covariance,
    jtj_covariance,
    residual_jacobian,
)
from .fit_metrics import fit_metrics
from .fit_simplex import function_tolerance, initial_simplex, nudge_inside, stalled_parameters

__all__ = ["curve_fit"]

_EPS = float(np.finfo(float).eps)
_HESSIAN_SIDE_MAX = 20
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
    covariance: str = "jtj",
    scale_errors: bool = True,
    legacy_metrics: bool = False,
) -> dict[str, Any]:
    """Bounded nonlinear least-squares fit. Port of fitting.curveFit.

    ``model_fcn(x, p) -> y``. Returns params/errors/covar/residuals/yFit plus
    R2/chiSqRed/RMSE/AIC and fit metadata.

    ``weights`` are least-squares weights used as given (Origin "direct
    weighting"); ``weights_from_dy`` turns 1-sigma error bars into the
    instrumental ``1/dy²``. ``covariance`` picks the parameter-error method
    (``calc.fit_covariance``): ``"jtj"`` (default; Origin / scipy
    ``curve_fit``) or ``"hessian"`` (MATLAB curveFit; the golden tests pin it).
    Both are returned as ``errorsJtj``/``errorsHessian`` (the unselected
    Hessian only up to 20 free parameters; NaN beyond, as it costs O(k²)). ``scale_errors``
    (Origin's "Scale Error with sqrt(Reduced Chi-Sqr)", default on) only
    matters for a weighted fit: off = the weights are absolute 1/sigma²
    (scipy ``absolute_sigma=True``). Metrics follow ``calc.fit_metrics``.
    A free parameter that never left its start while the cost still falls
    along it is reported in ``warnings`` and forces ``exitFlag`` 0, as does a
    model that is undefined (NaN/inf) at the fitted parameters.

    Zero-weight points are not observations: they are left out of ``nPoints``,
    the dof and every metric (their residuals are still returned). A free
    start on a bound is moved just inside it (``fit_simplex.nudge_inside``).
    ``obsVar`` is the per-point observation variance ``s²/wᵢ`` of a weighted
    fit (``None`` unweighted; ``inf`` at zero weight) -- what a prediction
    band adds at that point. ``legacy_metrics`` reproduces the statistics of
    results saved before 2026-11 (``RMSE = √(Σw r²/n)``, AIC without the
    ``Σ ln w`` term) for recomputing such a result without silently changing
    what its numbers mean.
    """
    if covariance not in COVARIANCE_METHODS:
        raise ValueError(f"covariance must be one of {COVARIANCE_METHODS}, got {covariance!r}")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    m = len(p0)
    n = xv.size
    # `rmse = sqrt(ss_res / n)` below is a plain-Python float/int division, so
    # n == 0 raises ZeroDivisionError rather than yielding nan the way the
    # neighbouring numpy divisions do -> unhandled HTTP 500 from /fitting/fit
    # and /fitting/equation/fit (neither `x`/`y` list has a pydantic
    # min_length, and passing an explicit `p0` skips auto_guess, so empty
    # arrays reach here). The sibling `/fitting/scan` already guards the same
    # degenerate case in `fit_scan.scan_models`; this carries it to the
    # shared fitter so every caller inherits it.
    if n == 0:
        raise ValueError("need at least one data point to fit")
    if n != yv.size:
        raise ValueError(f"x and y must be the same length (got {n} and {yv.size})")
    lb = np.array(lower if lower is not None else [-math.inf] * m, dtype=float)
    ub = np.array(upper if upper is not None else [math.inf] * m, dtype=float)
    fixed_mask = np.array(fixed if fixed is not None else [False] * m, dtype=bool)
    w = np.asarray(weights, dtype=float).ravel() if weights is not None else np.ones(n)
    if w.size != n:
        raise ValueError(f"weights must have {n} entries (one per point), got {w.size}")
    if not bool(np.all(np.isfinite(w))) or bool(np.any(w < 0)) or not bool(np.any(w > 0)):
        raise ValueError("weights must be finite, >= 0 and not all zero")
    sqrt_w = np.sqrt(w)

    free_idx = [k for k in range(m) if not fixed_mask[k]]
    n_free = len(free_idx)
    max_iter = 5000 * max(n_free, 1) if max_iter is None else max_iter
    p0_arr: NDArray[np.float64] = nudge_inside(
        np.asarray(np.clip(np.array(p0, dtype=float), lb, ub), dtype=float), lb, ub, free_idx
    )

    def from_free(p_free: NDArray[np.float64]) -> NDArray[np.float64]:
        pb = p0_arr.copy()
        for j, k in enumerate(free_idx):
            pb[k] = _free_to_bound(float(p_free[j]), lb[k], ub[k])
        return pb

    def resid_bound(pb: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray((yv - model_fcn(xv, pb)) * sqrt_w, dtype=float)

    def cost_bound(pb: NDArray[np.float64]) -> float:
        # A model undefined at pb (NaN/inf: a negative Voigt width, log of a
        # negative) is a wall, not a number Nelder-Mead may sort arbitrarily.
        with np.errstate(over="ignore", invalid="ignore"):
            val = float(np.sum(resid_bound(pb) ** 2))
        return val if math.isfinite(val) else math.inf

    def cost(p_free: NDArray[np.float64]) -> float:
        return cost_bound(from_free(p_free))

    p_free0 = np.array([_bound_to_free(p0_arr[k], lb[k], ub[k]) for k in free_idx])
    transformed = [bool(lb[k] > -math.inf or ub[k] < math.inf) for k in free_idx]
    # Explicit simplex: scipy's default except near-zero TRANSFORMED
    # coordinates (a start at lo + 1 maps to ~2e-16), see fit_simplex.
    simplex = initial_simplex(p_free0, transformed) if n_free > 0 else np.empty((0, 0))
    if n_free > 0 and not any(math.isfinite(cost(v)) for v in simplex):
        # Undefined at the start AND all around it: every vertex is a wall, so
        # there is nothing to descend. Reported below (exitFlag 0 + warning).
        x_opt = p_free0
        exit_flag, n_iter = 0, 0
    elif n_free > 0:
        res = minimize(
            cost, p_free0, method="Nelder-Mead",
            options={"maxiter": max_iter, "maxfev": max_iter * 2, "xatol": tol_x,
                     "fatol": function_tolerance(tol_fun, cost(p_free0)),
                     "initial_simplex": simplex},
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
    metrics = fit_metrics(residuals, n_free, None if weights is None else w,
                          legacy=legacy_metrics)
    n_obs = int(metrics["n"])  # points with a non-zero weight
    w_mean = float(np.sum(w * yv) / np.sum(w))
    ss_tot = float(np.sum(w * (yv - w_mean) ** 2))
    r2 = 1 - metrics["chiSq"] / max(ss_tot, _EPS)
    dof = n_obs - n_free
    chi_sq_red = float(metrics["chiSqRed"])
    # Error scaling (Origin "Scale Error with sqrt(Reduced Chi-Sqr)"): always
    # on for an unweighted fit -- there is no other variance estimate.
    scaled = scale_errors or weights is None
    s2 = chi_sq_red if scaled else 1.0
    est = calc_errors and n_free > 0 and dof > 0
    y_scale = float(np.linalg.norm(yv * sqrt_w))
    err_jtj, cov_jtj = _jtj_errors(resid_bound, p_opt, free_idx, lb, ub, m, s2, est, y_scale)
    # The Hessian costs O(n_free^2) model evaluations: always run when it is
    # the selected method, otherwise only as a cheap side-by-side (<= 20 free).
    est_hess = est and (covariance == "hessian" or n_free <= _HESSIAN_SIDE_MAX)
    err_hess, cov_hess = _hessian_errors(cost, x_opt, free_idx, lb, ub, m, s2, est_hess)
    errors, covar = (err_jtj, cov_jtj) if covariance == "jtj" else (err_hess, cov_hess)

    warnings: list[str] = []
    if not bool(np.all(np.isfinite(y_fit[w > 0]))):
        warnings.append(
            "the model is undefined (NaN or infinite) at the fitted parameters -- check the "
            "start values and bounds (e.g. a negative width)"
        )
    for k in stalled_parameters(cost_bound, p_opt, p0_arr, lb, ub, free_idx) if n_free else []:
        warnings.append(
            f"parameter {k + 1} never moved from its start value {p0_arr[k]:.6g} although the "
            "fit residual still falls along it; the optimizer stalled -- try another "
            "start value"
        )
    if warnings:
        exit_flag = 0  # never report a stalled fit as converged

    return {
        "params": p_opt,
        "errors": errors,
        "covar": covar,
        "errorsJtj": err_jtj,
        "errorsHessian": err_hess,
        "covariance": covariance,
        "errorsScaled": scaled,
        "residuals": residuals,
        "yFit": y_fit,
        "R2": r2,
        "chiSqRed": chi_sq_red,
        "chiSq": metrics["chiSq"],
        "SSR": metrics["SSR"],
        "RMSE": metrics["RMSE"],
        # Observation variance at a typical point, in y units squared: what a
        # prediction band adds to the curve's own variance (calc.fit_stats.
        # fit_bands). Unweighted: SSR/dof. Weighted: s2 * mean(1/w), i.e. the
        # mean per-point sigma^2 (times the reduced chi^2 when scaled).
        "MSE": s2 * float(np.mean(1.0 / w[w > 0])) if weights is not None else chi_sq_red,
        "obsVar": None if weights is None else _obs_var(w, s2),
        "AIC": metrics["AIC"],
        "AICc": metrics["AICc"],
        "BIC": metrics["BIC"],
        "logLik": metrics["logLik"],
        "warnings": warnings,
        "exitFlag": exit_flag,
        "nIter": n_iter,
        "nFree": n_free,
        "nPoints": n_obs,
    }


def _obs_var(w: NDArray[np.float64], s2: float) -> NDArray[np.float64]:
    """Per-point observation variance ``s2 / w`` (``inf`` at zero weight)."""
    out = np.full(w.size, math.inf)
    out[w > 0] = s2 / w[w > 0]
    return out


def _jtj_errors(
    resid_bound: Callable[[NDArray[np.float64]], NDArray[np.float64]],
    p_opt: NDArray[np.float64],
    free_idx: list[int],
    lb: NDArray[np.float64],
    ub: NDArray[np.float64],
    m: int,
    s2: float,
    estimate: bool,
    y_scale: float = 0.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64] | None]:
    """Origin/scipy errors: ``(JᵀWJ)⁻¹·s2`` in the bounded parameters."""
    errors = np.full(m, np.nan)
    if not estimate:
        return errors, None
    jac = residual_jacobian(resid_bound, p_opt, free_idx, lb, ub, y_scale)
    cov_free = jtj_covariance(jac, s2)
    if cov_free is None:
        return errors, None
    covar = np.zeros((m, m))
    covar[np.ix_(free_idx, free_idx)] = cov_free
    errors[free_idx] = np.sqrt(np.diag(cov_free))
    return errors, covar


def _hessian_errors(
    cost: Callable[[NDArray[np.float64]], float],
    x_opt: NDArray[np.float64],
    free_idx: list[int],
    lb: NDArray[np.float64],
    ub: NDArray[np.float64],
    m: int,
    s2: float,
    estimate: bool,
) -> tuple[NDArray[np.float64], NDArray[np.float64] | None]:
    """MATLAB curveFit errors: free-space Hessian of the SSR, mapped back."""
    errors = np.full(m, np.nan)
    if not estimate:
        return errors, None
    bjac = np.array([_bound_jacobian(float(x_opt[j]), lb[k], ub[k])
                     for j, k in enumerate(free_idx)])
    cov_free = hessian_covariance(_numerical_hessian(cost, x_opt), s2, bjac)
    if cov_free is None:
        return errors, None
    covar = np.zeros((m, m))
    covar[np.ix_(free_idx, free_idx)] = cov_free
    errors[free_idx] = np.sqrt(np.diag(cov_free))
    return errors, covar
