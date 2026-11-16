"""Bounded 2D least-squares surface fitting. Port of MATLAB ``fitting.surfaceFit``.

Fits a named 2D model (``calc/surface_models``) to scattered ``(x, y, z)`` data.
The MATLAB original minimises the sum of squared residuals with **fminsearch
(Nelder-Mead)** over a **bounded → unbounded parameter transform** (the same
idiosyncratic scheme ``curveFit`` uses), so this port replicates the transform
and uses scipy's Nelder-Mead rather than delegating to a different bounded
optimiser. Parameter errors come from the numerical Hessian of the cost at the
optimum, mapped back through the transform Jacobian.

Pure calc layer — ndarray in -> dict out; no fastapi/pydantic. ``p0`` (initial
guess) is required here; the MATLAB auto-guess (``surfaceAutoGuess``) is a
separate, still-to-port file.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

from quantized.calc.surface_models import SurfaceModel, get_surface_model

__all__ = ["surface_fit", "surface_auto_guess"]

_EPS = sys.float_info.epsilon


def _weighted_centroid(
    xa: NDArray[np.float64], ya: NDArray[np.float64], za: NDArray[np.float64], z_min: float
) -> tuple[float, float]:
    """Intensity-weighted (x, y) centre (weights = z - z_min, clamped >= 0)."""
    wts = np.maximum(za - z_min, 0.0)
    w_sum = max(float(np.sum(wts)), _EPS)
    return float(np.sum(wts * xa) / w_sum), float(np.sum(wts * ya) / w_sum)


def surface_auto_guess(
    model: str | SurfaceModel,
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
) -> NDArray[np.float64]:
    """Heuristic initial parameter guess for a 2D model. Port of
    ``fitting.surfaceAutoGuess``: linear models solve normal equations; peak
    models use ``z``-range amplitude, an intensity-weighted centroid, and
    range/4 widths."""
    mdl = get_surface_model(model) if isinstance(model, str) else model
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    za = np.asarray(z, dtype=float).ravel()
    n = za.size

    x_rng = max(float(xa.max() - xa.min()), _EPS)
    y_rng = max(float(ya.max() - ya.min()), _EPS)
    z_min = float(za.min())
    z_rng = max(float(za.max() - z_min), _EPS)
    z_mean = float(za.mean())

    name = mdl.name
    if name == "Plane":
        amat = np.column_stack([xa, ya, np.ones(n)])
        return _lstsq_or(amat, za, [0.0, 0.0, z_mean])
    if name == "Paraboloid":
        amat = np.column_stack([xa**2, ya**2, xa * ya, xa, ya, np.ones(n)])
        return _lstsq_or(amat, za, [0.0, 0.0, 0.0, 0.0, 0.0, z_mean])
    if name == "Polynomial 2D":
        amat = np.column_stack([np.ones(n), xa, ya, xa**2, xa * ya, ya**2])
        return _lstsq_or(amat, za, [z_mean, 0.0, 0.0, 0.0, 0.0, 0.0])
    if name in ("2D Gaussian", "2D Lorentzian", "2D Pseudo-Voigt"):
        amp = float(za.max()) - z_min
        x0, y0 = _weighted_centroid(xa, ya, za, z_min)
        guess = [amp, x0, x_rng / 4, y0, y_rng / 4, z_min]
        if name == "2D Pseudo-Voigt":
            guess.append(0.5)  # eta
        return np.asarray(guess, dtype=float)
    if name == "Exponential Decay 2D":
        return np.asarray([z_rng, x_rng / 3, y_rng / 3, z_min], dtype=float)

    # Generic fallback for any other model.
    out = np.ones(mdl.n_params, dtype=float)
    defaults = [
        z_rng,
        (float(xa.min()) + float(xa.max())) / 2,
        x_rng / 4,
        (float(ya.min()) + float(ya.max())) / 2,
        y_rng / 4,
        z_min,
    ]
    for i, val in enumerate(defaults[: mdl.n_params]):
        out[i] = val
    return out


def _lstsq_or(
    amat: NDArray[np.float64], z: NDArray[np.float64], fallback: list[float]
) -> NDArray[np.float64]:
    """Least-squares solve (MATLAB ``A \\ z``), falling back on a singular system."""
    try:
        coeffs, *_ = np.linalg.lstsq(amat, z, rcond=None)
        return np.asarray(coeffs, dtype=float).ravel()
    except np.linalg.LinAlgError:
        return np.asarray(fallback, dtype=float)


def _bound_to_free(pb: float, lo: float, hi: float) -> float:
    if lo == -np.inf and hi == np.inf:
        return pb
    if lo > -np.inf and hi == np.inf:
        return float(np.log(pb - lo + _EPS))
    if lo == -np.inf and hi < np.inf:
        return float(-np.log(hi - pb + _EPS))
    t = (pb - lo) / (hi - lo)
    t = max(min(t, 1 - _EPS), _EPS)
    return float(np.log(t / (1 - t)))


def _free_to_bound(pf: float, lo: float, hi: float) -> float:
    if lo == -np.inf and hi == np.inf:
        return pf
    if lo > -np.inf and hi == np.inf:
        return float(lo + np.exp(pf))
    if lo == -np.inf and hi < np.inf:
        return float(hi - np.exp(-pf))
    return float(lo + (hi - lo) / (1 + np.exp(-pf)))


def _bound_jacobian(pf: float, lo: float, hi: float) -> float:
    if lo == -np.inf and hi == np.inf:
        return 1.0
    if lo > -np.inf and hi == np.inf:
        return float(np.exp(pf))
    if lo == -np.inf and hi < np.inf:
        return float(np.exp(-pf))
    s = 1.0 / (1.0 + np.exp(-pf))
    return float((hi - lo) * s * (1 - s))


def _numerical_hessian(fun: Any, x0: NDArray[np.float64]) -> NDArray[np.float64]:
    """Central-difference Hessian (matches the MATLAB step ``max(|x|·1e-4, 1e-6)``)."""
    n = x0.size
    hess = np.zeros((n, n), dtype=float)
    f0 = fun(x0)
    h = np.maximum(np.abs(x0) * 1e-4, 1e-6)
    for i in range(n):
        xp = x0.copy()
        xp[i] += h[i]
        xm = x0.copy()
        xm[i] -= h[i]
        hess[i, i] = (fun(xp) - 2 * f0 + fun(xm)) / h[i] ** 2
        for j in range(i + 1, n):
            xpp, xpm, xmp, xmm = x0.copy(), x0.copy(), x0.copy(), x0.copy()
            xpp[i] += h[i]
            xpp[j] += h[j]
            xpm[i] += h[i]
            xpm[j] -= h[j]
            xmp[i] -= h[i]
            xmp[j] += h[j]
            xmm[i] -= h[i]
            xmm[j] -= h[j]
            hess[i, j] = (fun(xpp) - fun(xpm) - fun(xmp) + fun(xmm)) / (4 * h[i] * h[j])
            hess[j, i] = hess[i, j]
    return hess


def _bounds(
    bound: Sequence[float] | None, n: int, default: float, name: str
) -> NDArray[np.float64]:
    if bound is None:
        return np.full(n, default, dtype=float)
    arr = np.asarray(bound, dtype=float)
    if arr.size != n:
        raise ValueError(f"{name} must have {n} elements, got {arr.size}")
    return arr


def surface_fit(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    model: str | SurfaceModel,
    *,
    p0: Sequence[float] | None = None,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    max_iter: int = 10000,
    linear: bool = False,
) -> dict[str, Any]:
    """Fit ``model`` to scattered ``(x, y, z)``.

    ``p0`` is the initial guess; when omitted it is derived via
    :func:`surface_auto_guess`. ``lower``/``upper`` bound each parameter
    (defaults ``-inf``/``+inf``); ``lower == upper`` holds that parameter fixed
    (excluded from the fit and the degrees of freedom), ``lower > upper`` is an
    error. ``linear=True`` solves the linear models (plane, paraboloid, poly2d)
    exactly by least squares when nothing is bounded or held. Returns a dict with ``params``,
    ``param_names``, ``errors`` (1-sigma, NaN if the Hessian is singular),
    ``residuals``, ``z_fit``, ``r2``, ``rmse``, ``chi_sq_red``, ``model_name``,
    ``n_points``, ``n_free`` (fitted parameters), ``fixed``, ``exit_flag``.
    """
    mdl = get_surface_model(model) if isinstance(model, str) else model
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    za = np.asarray(z, dtype=float).ravel()
    n_pts = za.size
    n_p = mdl.n_params

    if p0 is None:
        p0_arr = surface_auto_guess(mdl, xa, ya, za)
    else:
        p0_arr = np.asarray(p0, dtype=float).ravel()
    if p0_arr.size != n_p:
        raise ValueError(f"p0 must have {n_p} elements for {mdl.name!r}, got {p0_arr.size}")
    lb = _bounds(lower, n_p, -np.inf, "lower")
    ub = _bounds(upper, n_p, np.inf, "upper")
    crossed = np.flatnonzero(lb > ub)
    if crossed.size:
        names = ", ".join(mdl.param_names[k] for k in crossed)
        raise ValueError(f"lower bound is above the upper bound for {names}")
    # lower == upper holds a parameter at that value (not fitted, no error).
    fixed = lb == ub
    free = np.flatnonzero(~fixed)
    n_f = int(free.size)

    if (
        linear
        and n_f == n_p
        and mdl.name in _LINEAR_DESIGN
        and np.isinf(lb).all()
        and np.isinf(ub).all()
    ):
        p_opt, errors_lin, ok = _linear_solve(mdl.name, xa, ya, za)
        res_success = ok
        p_free_opt = np.empty(0)
        cost = None
    else:
        p0_arr = np.clip(p0_arr, lb, ub)
        lbf, ubf = lb[free], ub[free]

        def expand(pf: NDArray[np.float64]) -> NDArray[np.float64]:
            full = np.where(fixed, lb, p0_arr)
            for j, k in enumerate(free):
                full[k] = _free_to_bound(float(pf[j]), float(lbf[j]), float(ubf[j]))
            return full

        def cost(p_free: NDArray[np.float64]) -> float:
            resid = za - mdl.func(expand(p_free), xa, ya).ravel()
            return float(np.sum(resid**2))

        p_free0 = np.array(
            [_bound_to_free(float(p0_arr[k]), float(lb[k]), float(ub[k])) for k in free]
        )
        if n_f:
            res = minimize(
                cost,
                p_free0,
                method="Nelder-Mead",
                options={
                    "xatol": 1e-10,
                    "fatol": 1e-12,
                    "maxiter": max_iter,
                    "maxfev": max_iter * 2,
                },
            )
            p_free_opt = np.asarray(res.x, dtype=float)
            res_success = bool(res.success)
        else:
            p_free_opt, res_success = p_free0, True
        p_opt = expand(p_free_opt)
        errors_lin = None
    z_fit = np.asarray(mdl.func(p_opt, xa, ya).ravel(), dtype=float)
    residuals = za - z_fit

    ss_res = float(np.sum(residuals**2))
    ss_tot = float(np.sum((za - za.mean()) ** 2))
    r2 = 1 - ss_res / max(ss_tot, _EPS)
    dof = n_pts - n_f
    chi_sq_red = ss_res / max(dof, 1)
    rmse = float(np.sqrt(ss_res / n_pts))

    if errors_lin is not None:
        errors = errors_lin * (np.sqrt(chi_sq_red) if dof > 0 else np.nan)
    else:
        errors = np.full(n_p, np.nan, dtype=float)
        if n_f:
            errors[free] = _param_errors(cost, p_free_opt, lb[free], ub[free], dof, chi_sq_red, n_f)

    return {
        "params": p_opt,
        "param_names": list(mdl.param_names),
        "errors": errors,
        "residuals": residuals,
        "z_fit": z_fit,
        "r2": r2,
        "rmse": rmse,
        "chi_sq_red": chi_sq_red,
        "model_name": mdl.name,
        "n_points": int(n_pts),
        "n_free": n_f,
        "fixed": [bool(f) for f in fixed],
        "exit_flag": 1 if res_success else 0,
    }


_LINEAR_DESIGN = {"Plane", "Paraboloid", "Polynomial 2D"}


def _linear_solve(
    name: str, x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], bool]:
    """Exact least squares for the linear surface models (parameter order as
    in the catalog). Returns ``(params, unit-variance standard errors, ok)``."""
    one = np.ones_like(x)
    cols = {
        "Plane": [x, y, one],
        "Paraboloid": [x**2, y**2, x * y, x, y, one],
        "Polynomial 2D": [one, x, y, x**2, x * y, y**2],
    }[name]
    amat = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(amat, z, rcond=None)
    try:
        se = np.sqrt(np.diag(np.linalg.inv(amat.T @ amat)))
    except np.linalg.LinAlgError:
        se = np.full(amat.shape[1], np.nan)
    return np.asarray(coef, dtype=float), np.asarray(se, dtype=float), True


def _param_errors(
    cost: Any,
    p_free_opt: NDArray[np.float64],
    lb: NDArray[np.float64],
    ub: NDArray[np.float64],
    dof: int,
    chi_sq_red: float,
    n_p: int,
) -> NDArray[np.float64]:
    """1-sigma errors via the numerical Hessian, mapped through the transform Jacobian."""
    errors = np.full(n_p, np.nan, dtype=float)
    if dof <= 0:
        return errors
    hess = _numerical_hessian(cost, p_free_opt)
    try:
        cov_free = np.linalg.inv(hess / 2) * chi_sq_red
    except np.linalg.LinAlgError:
        return errors
    diag = np.diag(cov_free)
    if np.all(diag >= 0):
        se_free = np.sqrt(diag)
        for k in range(n_p):
            errors[k] = se_free[k] * abs(_bound_jacobian(p_free_opt[k], lb[k], ub[k]))
    return errors
