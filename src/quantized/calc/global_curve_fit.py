"""Global curve fitting with named per-group shared parameters. Port of
fitting.globalCurveFit.

Pure calc layer. Richer than ``global_fit`` (which shares a parameter across *all*
datasets via a boolean mask): here each *constraint* names a parameter and the
*subset* of datasets that share it, so parameter X can be shared among datasets
{0,1} while dataset 2 keeps its own X. Per-dataset models/bounds are allowed.

Method (matches MATLAB): builds a super-parameter vector
``[shared_group_1..G, free per-(dataset,param) slots]``, optimises the summed
weighted residuals with Nelder-Mead over the logit/log bound transform (the same
machinery as ``curveFit``), and derives errors from a central-difference Hessian
of the global cost scaled by the global reduced chi-squared. Beechem, Methods
Enzymol. 210, 37 (1992).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize

from quantized.datastruct import DataStruct

from .fitting import (
    _bound_jacobian,
    _bound_to_free,
    _free_to_bound,
    _numerical_hessian,
)

__all__ = ["global_curve_fit"]

_EPS = float(np.finfo(float).eps)
ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]

# ASCII Greek-letter name aliases (port of globalCurveFit greekAliases).
_GREEK = {
    "sigma": "σ", "mu": "μ", "gamma": "γ", "eta": "η", "tau": "τ",
    "lambda": "λ", "alpha": "α", "beta": "β", "phi": "φ", "theta": "θ",
    "omega": "ω", "pi": "π", "delta": "δ", "epsilon": "ε", "kappa": "κ",
    "rho": "ρ", "chi": "χ", "psi": "ψ", "nu": "ν", "xi": "ξ",
}


def _greek_aliases(name: str) -> list[str]:
    out: list[str] = []
    low = name.lower()
    for ascii_name, glyph in _GREEK.items():
        if low == ascii_name:
            out.append(glyph)
        elif name == glyph:
            out.append(ascii_name)
    return out


def _resolve_param(name: str, param_names: Sequence[str]) -> int:
    if name in param_names:
        return list(param_names).index(name)
    for alias in _greek_aliases(name):
        if alias in param_names:
            return list(param_names).index(alias)
    raise ValueError(f'parameter "{name}" not found in model param names')


def _extract_xy(
    ds: DataStruct | tuple[Any, Any] | list[Any], channel: int = 0
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if isinstance(ds, DataStruct):
        x = np.asarray(ds.time, dtype=float).ravel()
        values = np.asarray(ds.values, dtype=float)
        y = values[:, channel] if values.ndim == 2 else values.ravel()
        return x, np.asarray(y, dtype=float).ravel()
    if isinstance(ds, (tuple, list)) and len(ds) >= 2:
        return np.asarray(ds[0], dtype=float).ravel(), np.asarray(ds[1], dtype=float).ravel()
    raise ValueError("each dataset must be a (x, y) pair or a DataStruct")


def _per_dataset(
    arg: Sequence[Any] | None, k: int, p: int, default: NDArray[np.float64]
) -> list[NDArray[np.float64]]:
    """Normalise a per-dataset vector argument: None -> default broadcast; a single
    length-P vector -> broadcast; a list of K vectors -> as-is."""
    if arg is None:
        return [default.copy() for _ in range(k)]
    arr = np.asarray(arg, dtype=float)
    if arr.ndim == 1:  # single vector broadcasts to all datasets
        return [arr.astype(float).copy() for _ in range(k)]
    if arr.shape[0] != k:
        raise ValueError(f"expected {k} per-dataset vectors, got {arr.shape[0]}")
    return [np.asarray(arr[i], dtype=float) for i in range(k)]


def global_curve_fit(
    datasets: list[Any],
    model_fcn: ModelFn | Sequence[ModelFn],
    param_names: Sequence[str],
    constraints: Sequence[dict[str, Any]] | None,
    *,
    init_guess: Sequence[Any],
    lower: Sequence[Any] | None = None,
    upper: Sequence[Any] | None = None,
    weights: Sequence[Any] | None = None,
    max_iter: int = 20000,
    tol_fun: float = 1e-12,
    tol_x: float = 1e-10,
    channel: int = 0,
) -> dict[str, Any]:
    """Fit a model to ``datasets`` with named per-group shared parameters.

    Port of fitting.globalCurveFit. ``model_fcn`` is one callable (broadcast) or a
    list of K callables. ``param_names`` is the length-P parameter list (shared by
    all models). ``constraints`` is a list of ``{"param_name": str, "datasets":
    [i, ...]}`` (0-based dataset indices); only groups of ≥2 datasets share.
    ``init_guess`` is a list of K length-P start vectors. ``lower``/``upper`` are a
    single length-P vector (broadcast) or a list of K vectors. ``weights`` is an
    optional list of K length-N weight vectors. Returns a dict with per-dataset
    ``params``/``errors``/``residuals``/``yFit``/``R2``/``RMSE``, a ``shared``
    summary list, ``chiSqRed``, ``covar``, ``nTotal``, ``nFree``, ``exitFlag``.
    """
    k = len(datasets)
    if k < 1:
        raise ValueError("need at least one dataset")
    p = len(param_names)

    fcns: list[ModelFn] = [model_fcn] * k if callable(model_fcn) else list(model_fcn)
    if len(fcns) != k:
        raise ValueError(f"model_fcn list must have {k} elements (one per dataset)")

    x_all: list[NDArray[np.float64]] = []
    y_all: list[NDArray[np.float64]] = []
    w_all: list[NDArray[np.float64]] = []
    n_pts: list[int] = []
    for i, ds in enumerate(datasets):
        xi, yi = _extract_xy(ds, channel)
        x_all.append(xi)
        y_all.append(yi)
        n_pts.append(xi.size)
        if weights is not None and i < len(weights) and weights[i] is not None:
            wi = np.asarray(weights[i], dtype=float).ravel()
            if wi.size != xi.size:
                raise ValueError(f"weights[{i}] must have {xi.size} elements")
            w_all.append(wi)
        else:
            w_all.append(np.ones(xi.size))
    n_total = int(sum(n_pts))

    inf_p = np.full(p, math.inf)
    p0_cell = _per_dataset(init_guess, k, p, np.zeros(p))
    lb_cell = _per_dataset(lower, k, p, -inf_p)
    ub_cell = _per_dataset(upper, k, p, inf_p)
    # Clamp p0 to bounds (MATLAB clamps after assembling).
    p0_cell = [np.clip(p0_cell[i], lb_cell[i], ub_cell[i]) for i in range(k)]

    # ── sharing groups from constraints ──────────────────────────────────────
    sharing: list[dict[str, Any]] = []
    for c in constraints or []:
        p_idx = _resolve_param(str(c["param_name"]), param_names)
        ds_list = sorted({int(d) for d in c["datasets"]})
        if any(d < 0 or d >= k for d in ds_list):
            raise ValueError(f"constraint dataset indices must be in [0, {k - 1}]")
        if len(ds_list) < 2:
            continue  # only meaningful when 2+ datasets share
        sharing.append({"param_idx": p_idx, "param_name": str(c["param_name"]),
                        "datasets": ds_list})
    n_groups = len(sharing)

    is_shared = np.zeros((k, p), dtype=bool)
    super_idx = np.zeros((k, p), dtype=int)
    for g, grp in enumerate(sharing):
        for ki in grp["datasets"]:
            is_shared[ki, grp["param_idx"]] = True
            super_idx[ki, grp["param_idx"]] = g  # shared slots take positions 0..G-1
    nxt = n_groups
    for ki in range(k):
        for pi in range(p):
            if not is_shared[ki, pi]:
                super_idx[ki, pi] = nxt
                nxt += 1
    n_super = nxt

    super_p0 = np.zeros(n_super)
    super_lb = np.full(n_super, -math.inf)
    super_ub = np.full(n_super, math.inf)
    for g, grp in enumerate(sharing):
        pi = grp["param_idx"]
        vals = [p0_cell[ki][pi] for ki in grp["datasets"]]
        lbs = [lb_cell[ki][pi] for ki in grp["datasets"]]
        ubs = [ub_cell[ki][pi] for ki in grp["datasets"]]
        super_lb[g] = max(lbs)  # tightest bounds win
        super_ub[g] = min(ubs)
        super_p0[g] = min(max(float(np.mean(vals)), super_lb[g]), super_ub[g])
    for ki in range(k):
        for pi in range(p):
            if not is_shared[ki, pi]:
                si = super_idx[ki, pi]
                super_p0[si] = p0_cell[ki][pi]
                super_lb[si] = lb_cell[ki][pi]
                super_ub[si] = ub_cell[ki][pi]

    sqrt_w = [np.sqrt(w_all[i]) for i in range(k)]

    def from_free_all(pf: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.array([_free_to_bound(float(pf[s]), super_lb[s], super_ub[s])
                         for s in range(n_super)])

    def expand(sp: NDArray[np.float64]) -> list[NDArray[np.float64]]:
        return [np.array([sp[super_idx[ki, pi]] for pi in range(p)]) for ki in range(k)]

    def cost(pf: NDArray[np.float64]) -> float:
        sp = from_free_all(pf)
        plist = expand(sp)
        total = 0.0
        for ki in range(k):
            resid = (y_all[ki] - fcns[ki](x_all[ki], plist[ki])) * sqrt_w[ki]
            total += float(np.sum(resid**2))
        return total

    pf0 = np.array([_bound_to_free(float(super_p0[s]), super_lb[s], super_ub[s])
                    for s in range(n_super)])
    if n_super > 0:
        res = minimize(
            cost, pf0, method="Nelder-Mead",
            options={"maxiter": max_iter, "maxfev": max_iter * 4,
                     "xatol": tol_x, "fatol": tol_fun},
        )
        pf_opt = np.asarray(res.x, dtype=float)
        exit_flag = 1 if res.success else 0
    else:
        pf_opt = pf0
        exit_flag = 1

    sp_opt = from_free_all(pf_opt)
    plist_opt = expand(sp_opt)

    ss_res_total = 0.0
    for ki in range(k):
        resid = (y_all[ki] - fcns[ki](x_all[ki], plist_opt[ki])) * sqrt_w[ki]
        ss_res_total += float(np.sum(resid**2))
    dof = n_total - n_super
    chi_sq_red = ss_res_total / max(dof, 1)

    super_err = np.full(n_super, np.nan)
    covar: NDArray[np.float64] | None = None
    if n_super > 0 and dof > 0:
        hess = _numerical_hessian(cost, pf_opt)
        try:
            cov_free = np.asarray(np.linalg.inv(hess / 2) * chi_sq_red, dtype=float)
            if np.all(np.diag(cov_free) >= 0):
                se_free = np.sqrt(np.diag(cov_free))
                jac = np.array([_bound_jacobian(float(pf_opt[s]), super_lb[s], super_ub[s])
                                for s in range(n_super)])
                super_err = se_free * np.abs(jac)
                jmat = np.diag(jac)
                covar = np.asarray(jmat @ cov_free @ jmat.T, dtype=float)
        except np.linalg.LinAlgError:
            pass

    params: list[list[float]] = []
    errors: list[list[float]] = []
    residuals: list[NDArray[np.float64]] = []
    y_fit: list[NDArray[np.float64]] = []
    r2 = np.zeros(k)
    rmse = np.zeros(k)
    for ki in range(k):
        params.append([float(v) for v in plist_opt[ki]])
        errors.append([float(super_err[super_idx[ki, pi]]) for pi in range(p)])
        ym = np.asarray(fcns[ki](x_all[ki], plist_opt[ki]), dtype=float)
        y_fit.append(ym)
        res_k = y_all[ki] - ym
        residuals.append(np.asarray(res_k, dtype=float))
        ss_res = float(np.sum(w_all[ki] * res_k**2))
        w_mean = float(np.sum(w_all[ki] * y_all[ki]) / np.sum(w_all[ki]))
        ss_tot = float(np.sum(w_all[ki] * (y_all[ki] - w_mean) ** 2))
        r2[ki] = 1 - ss_res / max(ss_tot, _EPS)
        rmse[ki] = math.sqrt(ss_res / n_pts[ki])

    shared_out: list[dict[str, Any]] = []
    for g, grp in enumerate(sharing):
        shared_out.append({
            "name": grp["param_name"],
            "paramIdx": grp["param_idx"],
            "datasets": grp["datasets"],
            "value": float(sp_opt[g]),
            "error": float(super_err[g]),
        })

    return {
        "params": params,
        "errors": errors,
        "shared": shared_out,
        "residuals": residuals,
        "yFit": y_fit,
        "R2": r2,
        "RMSE": rmse,
        "chiSqRed": float(chi_sq_red),
        "covar": covar,
        "nTotal": n_total,
        "nFree": n_super,
        "exitFlag": exit_flag,
    }
