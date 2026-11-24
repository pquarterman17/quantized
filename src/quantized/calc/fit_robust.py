"""Outlier-robust curve fitting (GAP_AUDIT_9 G11, lane 9 ROBUST).

Pure calc layer. Two estimators, both opt-in beside the plain least-squares
fitter (``calc.fitting.curve_fit`` is untouched):

* :func:`robust_curve_fit` -- any registered nonlinear model with a robust
  loss ``rho`` (``soft_l1``, ``huber``, ``cauchy``; ``linear`` is plain least
  squares). It delegates to ``scipy.optimize.least_squares(loss=, f_scale=)``
  (trust-region reflective, bounds supported), so the optimum is scipy's own.
  Loss definitions (scipy docs, ``least_squares``), with ``z = (r/f_scale)^2``:
  ``huber``  rho = z (z<=1) else 2 sqrt(z) - 1; ``soft_l1`` rho = 2(sqrt(1+z)-1);
  ``cauchy`` rho = ln(1+z). ``f_scale`` is the residual size beyond which a
  point counts as an outlier. OriginLab offers the same idea as robust
  fitting in Nonlinear Curve Fit (Origin help, "Fitting with robust loss").
* :func:`bisquare_irls` -- Tukey-bisquare (biweight) M-estimation of a
  polynomial by iteratively reweighted least squares. Tuning constant
  ``c = 4.685`` (95 % efficiency at the normal; Holland & Welsch 1977), scale
  = median |residual| / 0.6745 re-estimated each
  iteration, start = OLS, covariance = Huber's H1 -- the defaults of
  ``statsmodels.robust.robust_linear_model.RLM(norm=TukeyBiweight())``, which
  the tests use as the oracle.

Provisional, owner to confirm: the automatic ``f_scale`` (normal-consistent
MAD of the plain least-squares residuals), the outlier flag (robust weight
< 0.5) and the parameter errors of the nonlinear robust fit (Gauss-Newton
``inv(J'J)`` of scipy's loss-modified Jacobian times the robust residual
variance; an approximation, not an exact sandwich estimator).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import least_squares

__all__ = ["LOSSES", "auto_f_scale", "bisquare_irls", "clean_xy", "poly_design", "robust_curve_fit"]

LOSSES = ("linear", "soft_l1", "huber", "cauchy")
MAX_POLY_DEGREE = 8
TUKEY_C = 4.685  # Holland & Welsch (1977): 95 % efficiency under normal errors
_MAD_NORM = 0.6744897501960817  # Phi^-1(3/4), statsmodels' Gaussian.ppf(3/4)

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def _degenerate(scale: float, y: NDArray[np.float64]) -> bool:
    return not scale > 1e-12 * (1.0 + float(np.max(np.abs(y))))


def _mad(r: NDArray[np.float64]) -> float:
    """Median absolute residual (centre 0, as statsmodels' RLM), normal-consistent."""
    return float(np.median(np.abs(r)) / _MAD_NORM)


def auto_f_scale(resid: ArrayLike) -> float:
    """Default ``f_scale``: normal-consistent MAD of the residuals (provisional)."""
    s = _mad(np.asarray(resid, dtype=float).ravel())
    if not math.isfinite(s) or s <= 0.0:
        raise ValueError("residual scale is zero: the data fit exactly, give f_scale explicitly")
    return s


def _rho_weights(loss: str, r: NDArray[np.float64], f: float) -> NDArray[np.float64]:
    """rho'(z) per point (1 = untouched, -> 0 = discounted outlier)."""
    z = (r / f) ** 2
    if loss == "linear":
        return np.ones_like(z)
    if loss == "soft_l1":
        return np.asarray(1.0 / np.sqrt(1.0 + z), dtype=float)
    if loss == "cauchy":
        return np.asarray(1.0 / (1.0 + z), dtype=float)
    return np.asarray(np.where(z <= 1.0, 1.0, 1.0 / np.sqrt(np.maximum(z, 1e-300))), dtype=float)


def clean_xy(x: ArrayLike, y: ArrayLike) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """x, y as equal-length finite float vectors, else ``ValueError``."""
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"x and y must be the same length (got {xv.size} and {yv.size})")
    if not (np.all(np.isfinite(xv)) and np.all(np.isfinite(yv))):
        raise ValueError("x and y must be finite")
    return xv, yv


def robust_curve_fit(
    x: ArrayLike,
    y: ArrayLike,
    model_fcn: ModelFn,
    p0: Sequence[float],
    *,
    loss: str = "soft_l1",
    f_scale: float | None = None,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    weights: ArrayLike | None = None,
) -> dict[str, Any]:
    """Robust bounded nonlinear fit of ``model_fcn(x, p)`` to (x, y).

    ``weights`` are least-squares weights (residuals scaled by ``sqrt(w)``, as
    ``curve_fit``). ``f_scale=None`` -> :func:`auto_f_scale` of the plain
    least-squares residuals. The response always carries the plain
    least-squares parameters (``lsParams``) from the same start so the effect
    of the outliers is visible.
    """
    if loss not in LOSSES:
        raise ValueError(f"loss must be one of {LOSSES}, got {loss!r}")
    xv, yv = clean_xy(x, y)
    m, n = len(p0), xv.size
    if n <= m:
        raise ValueError(f"need more points than parameters (n={n}, params={m})")
    w = np.ones(n) if weights is None else np.asarray(weights, dtype=float).ravel()
    if w.size != n or not np.all(np.isfinite(w)) or np.any(w < 0) or not np.any(w > 0):
        raise ValueError("weights must have one finite entry >= 0 per point, not all zero")
    sw = np.sqrt(w)
    lb = np.full(m, -np.inf) if lower is None else np.asarray(lower, dtype=float)
    ub = np.full(m, np.inf) if upper is None else np.asarray(upper, dtype=float)
    if lb.size != m or ub.size != m or np.any(lb >= ub):
        raise ValueError("bounds must be one (lower < upper) pair per parameter")
    if f_scale is not None and not (math.isfinite(f_scale) and f_scale > 0):
        raise ValueError("f_scale must be a positive finite number")
    start = np.clip(np.asarray(p0, dtype=float), lb, ub)
    # scipy's trf needs a strictly feasible start.
    with np.errstate(invalid="ignore"):
        start = np.where(np.isfinite(lb) & (start <= lb), lb + 1e-10 * (1 + np.abs(lb)), start)
        start = np.where(np.isfinite(ub) & (start >= ub), ub - 1e-10 * (1 + np.abs(ub)), start)

    def resid(p: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(sw * (model_fcn(xv, p) - yv), dtype=float)

    ls = least_squares(resid, start, bounds=(lb, ub), method="trf", x_scale="jac")
    f = auto_f_scale(ls.fun) if f_scale is None else float(f_scale)
    sol = ls if loss == "linear" else least_squares(
        resid, ls.x, bounds=(lb, ub), method="trf", loss=loss, f_scale=f, x_scale="jac",
        max_nfev=2000 * max(m, 1),
    )
    p = np.asarray(sol.x, dtype=float)
    r_w = np.asarray(resid(p), dtype=float)  # weighted residuals
    rw = _rho_weights(loss, r_w, f)
    s2 = float(np.sum(rw * r_w**2) / max(n - m, 1))
    errs: NDArray[np.float64] = np.full(m, np.nan)
    try:
        jtj_inv = np.linalg.inv(sol.jac.T @ sol.jac)
        errs = np.asarray(np.sqrt(np.abs(np.diag(jtj_inv)) * s2), dtype=float)
    except np.linalg.LinAlgError:
        pass
    y_fit = np.asarray(model_fcn(xv, p), dtype=float)
    return {
        "params": p,
        "errors": errs,
        "yFit": y_fit,
        "residuals": yv - y_fit,
        "robustWeights": rw,
        "outliers": np.flatnonzero(rw < 0.5),
        "loss": loss,
        "fScale": f,
        "fScaleAuto": f_scale is None,
        "cost": float(sol.cost),
        "lsParams": np.asarray(ls.x, dtype=float),
        "nPoints": n,
        "success": bool(sol.success),
        "message": str(sol.message),
    }


def poly_design(x: NDArray[np.float64], degree: int) -> NDArray[np.float64]:
    """Monomial design matrix, columns ``1, x, ..., x^degree`` (intercept first)."""
    if not 1 <= degree <= MAX_POLY_DEGREE:
        raise ValueError(f"polynomial degree must be 1..{MAX_POLY_DEGREE}, got {degree}")
    return np.asarray(np.vander(x, degree + 1, increasing=True), dtype=float)


def _tukey_w(z: NDArray[np.float64], c: float) -> NDArray[np.float64]:
    return np.asarray(np.where(np.abs(z) <= c, (1 - (z / c) ** 2) ** 2, 0.0), dtype=float)


def _tukey_dpsi(z: NDArray[np.float64], c: float) -> NDArray[np.float64]:
    u = (z / c) ** 2
    return np.asarray(np.where(np.abs(z) <= c, (1 - u) ** 2 - 4 * u * (1 - u), 0.0), dtype=float)


def bisquare_irls(
    x: ArrayLike,
    y: ArrayLike,
    degree: int = 1,
    *,
    c: float = TUKEY_C,
    tol: float = 1e-10,
    max_iter: int = 200,
) -> dict[str, Any]:
    """Tukey-bisquare IRLS polynomial fit (degree 1 = straight line).

    Coefficients are returned lowest power first (``coefficients[k]`` is the
    ``x^k`` term). ``errors`` use Huber's H1 covariance (the statsmodels
    ``RLM`` default). Fail closed on a rank-deficient design, a degenerate
    (zero) residual scale, or too few surviving points.
    """
    xv, yv = clean_xy(x, y)
    if not (math.isfinite(c) and c > 0):
        raise ValueError("c must be a positive finite number")
    X = poly_design(xv, degree)
    n, p = X.shape
    if n <= p:
        raise ValueError(f"need more points than coefficients (n={n}, coefficients={p})")
    if np.linalg.matrix_rank(X) < p:
        raise ValueError("design is rank deficient (too few distinct x values for this degree)")
    ols = np.asarray(np.linalg.lstsq(X, yv, rcond=None)[0], dtype=float)
    beta = ols
    converged = False
    it = 0
    while it < max_iter:
        it += 1
        scale = _mad(yv - X @ beta)
        if _degenerate(scale, yv):
            raise ValueError("residual scale is zero (over half the points fitted exactly)")
        sw = np.sqrt(_tukey_w((yv - X @ beta) / scale, c))
        if np.count_nonzero(sw) < p:
            raise ValueError("bisquare left fewer points than coefficients; no robust fit")
        new = np.asarray(np.linalg.lstsq(X * sw[:, None], yv * sw, rcond=None)[0], dtype=float)
        step = float(np.max(np.abs(new - beta)))
        beta = new
        if step <= tol * (1.0 + float(np.max(np.abs(beta)))):
            converged = True
            break
    r = yv - X @ beta
    scale = _mad(r)
    if _degenerate(scale, yv):
        raise ValueError("residual scale is zero (over half the points fitted exactly)")
    z = r / scale
    dpsi = _tukey_dpsi(z, c)
    m_ = float(np.mean(dpsi))
    errs: NDArray[np.float64] = np.full(p, np.nan)
    if m_ > 0:
        k = 1 + p / n * float(np.var(dpsi)) / m_**2
        ss_psi = float(np.sum((z * _tukey_w(z, c)) ** 2))
        cov = k**2 * (ss_psi * scale**2 / (n - p)) / m_**2 * np.linalg.inv(X.T @ X)
        errs = np.asarray(np.sqrt(np.diag(cov)), dtype=float)
    w = _tukey_w(z, c)
    return {
        "coefficients": beta,
        "errors": errs,
        "yFit": X @ beta,
        "residuals": r,
        "robustWeights": w,
        "outliers": np.flatnonzero(w < 0.5),
        "scale": scale,
        "c": float(c),
        "degree": int(degree),
        "iterations": it,
        "converged": converged,
        "olsCoefficients": ols,
        "nPoints": n,
    }
