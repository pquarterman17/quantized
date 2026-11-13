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

from .fit_covariance import (
    COVARIANCE_METHODS,
    hessian_covariance,
    jtj_covariance,
    residual_jacobian,
)
from .fit_simplex import function_tolerance, initial_simplex, nudge_inside, stalled_parameters
from .fitting import (
    _bound_jacobian,
    _bound_to_free,
    _free_to_bound,
    _numerical_hessian,
)

__all__ = [
    "GlobalFitCancelled",
    "global_curve_fit",
    "held_slots",
    "share_groups",
    "slot_layout",
]

_EPS = float(np.finfo(float).eps)
ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


class GlobalFitCancelled(Exception):
    """Raised when ``abort_check`` asks a running global fit to stop."""

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


def share_groups(
    constraints: Sequence[dict[str, Any]] | None, param_names: Sequence[str], k: int
) -> list[dict[str, Any]]:
    """Resolve ``constraints`` to sharing groups ``{"param_idx", "param_name",
    "datasets"}`` (sorted, 0-based). Raises ``ValueError`` on an unknown
    parameter or an out-of-range dataset index; a group of fewer than two
    datasets shares nothing and is dropped (as in MATLAB)."""
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
    return sharing


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
    fixed: Sequence[Any] | None = None,
    covariance: str = "jtj",
    max_iter: int = 20000,
    tol_fun: float = 1e-12,
    tol_x: float = 1e-10,
    channel: int = 0,
    progress_callback: Callable[[float, str], None] | None = None,
    abort_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Fit a model to ``datasets`` with named per-group shared parameters.

    Port of fitting.globalCurveFit. ``model_fcn`` is one callable (broadcast) or a
    list of K callables. ``param_names`` is the length-P parameter list (shared by
    all models). ``constraints`` is a list of ``{"param_name": str, "datasets":
    [i, ...]}`` (0-based dataset indices); only groups of ≥2 datasets share.
    ``init_guess`` is a list of K length-P start vectors. ``lower``/``upper`` are a
    single length-P vector (broadcast) or a list of K vectors. ``weights`` is an
    optional list of K length-N weight vectors (``1/dy²`` for instrumental
    error bars). ``fixed`` (not in MATLAB) holds parameters at their start: a
    single length-P bool vector (broadcast) or K vectors; a shared group must
    be held in all of its datasets or none (else ``ValueError``). Held slots
    report NaN errors and do not count as free. ``covariance`` picks the
    error method as in ``curve_fit`` (``calc.fit_covariance``): ``"jtj"``
    (default; scipy/Origin) or ``"hessian"`` (MATLAB; golden-pinned). Returns
    a dict with per-dataset
    ``params``/``errors`` (plus ``errorsJtj``/``errorsHessian``, both
    estimates)/``residuals``/``yFit``/``R2``/``RMSE`` (unweighted, y units)/
    ``chiSq`` (weighted), a ``shared``
    summary list, ``chiSqRed``, ``covar``, ``nTotal``, ``nFree``, ``exitFlag``,
    ``warnings`` (a stalled parameter, as in ``curve_fit``; forces exitFlag 0).

    Long-run hooks (not in MATLAB; they never change the answer):
    ``progress_callback(fraction, message)`` fires once per Nelder-Mead
    iteration with ``fraction = iteration / max_iter`` (an upper bound on the
    work left, not an ETA — the simplex usually converges far sooner).
    ``abort_check()`` is polled before every cost evaluation, so it also covers
    the error Hessian; ``True`` raises :class:`GlobalFitCancelled`. A progress
    callback that raises (e.g. a job runner's cancel) propagates unchanged.
    """
    k = len(datasets)
    if k < 1:
        raise ValueError("need at least one dataset")
    if covariance not in COVARIANCE_METHODS:
        raise ValueError(f"covariance must be one of {COVARIANCE_METHODS}, got {covariance!r}")
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
    # Zero-weight points are not observations (as in curve_fit).
    n_total = int(sum(int(np.count_nonzero(wi > 0)) for wi in w_all))

    inf_p = np.full(p, math.inf)
    p0_cell = _per_dataset(init_guess, k, p, np.zeros(p))
    lb_cell = _per_dataset(lower, k, p, -inf_p)
    ub_cell = _per_dataset(upper, k, p, inf_p)
    # Clamp p0 to bounds (MATLAB clamps after assembling).
    p0_cell = [np.clip(p0_cell[i], lb_cell[i], ub_cell[i]) for i in range(k)]

    sharing = share_groups(constraints, param_names, k)

    is_shared, super_idx, n_super = slot_layout(sharing, k, p)

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

    held = held_slots(fixed, k, p, super_idx, n_super)
    slots = [s for s in range(n_super) if not held[s]]  # optimised super slots
    # A free start ON a bound would freeze there (fit_simplex.nudge_inside).
    super_p0 = nudge_inside(super_p0, super_lb, super_ub, slots)
    n_free = len(slots)
    sqrt_w = [np.sqrt(w_all[i]) for i in range(k)]

    def from_free_all(pf: NDArray[np.float64]) -> NDArray[np.float64]:
        sp = super_p0.copy()
        for j, s in enumerate(slots):
            sp[s] = _free_to_bound(float(pf[j]), super_lb[s], super_ub[s])
        return sp

    def expand(sp: NDArray[np.float64]) -> list[NDArray[np.float64]]:
        return [np.array([sp[super_idx[ki, pi]] for pi in range(p)]) for ki in range(k)]

    def resid_super(sp: NDArray[np.float64]) -> NDArray[np.float64]:
        if abort_check is not None and abort_check():
            raise GlobalFitCancelled("global fit cancelled")
        plist = expand(sp)
        return np.concatenate([(y_all[ki] - fcns[ki](x_all[ki], plist[ki])) * sqrt_w[ki]
                               for ki in range(k)])

    def cost_super(sp: NDArray[np.float64]) -> float:
        with np.errstate(over="ignore", invalid="ignore"):
            val = float(np.sum(resid_super(sp) ** 2))
        return val if math.isfinite(val) else math.inf  # undefined model = a wall

    def cost(pf: NDArray[np.float64]) -> float:
        return cost_super(from_free_all(pf))

    pf0 = np.array([_bound_to_free(float(super_p0[s]), super_lb[s], super_ub[s])
                    for s in slots])
    iteration = [0]

    def on_iteration(_xk: NDArray[np.float64]) -> None:
        iteration[0] += 1
        if progress_callback is not None:
            progress_callback(
                min(iteration[0] / max_iter, 1.0), f"Nelder-Mead iteration {iteration[0]}"
            )

    if n_free > 0:
        transformed = [bool(super_lb[s] > -math.inf or super_ub[s] < math.inf) for s in slots]
        res = minimize(
            cost, pf0, method="Nelder-Mead", callback=on_iteration,
            options={"maxiter": max_iter, "maxfev": max_iter * 4,
                     "xatol": tol_x, "fatol": function_tolerance(tol_fun, cost(pf0)),
                     "initial_simplex": initial_simplex(pf0, transformed)},
        )
        pf_opt = np.asarray(res.x, dtype=float)
        exit_flag = 1 if res.success else 0
    else:
        pf_opt = pf0
        exit_flag = 1

    sp_opt = from_free_all(pf_opt)
    plist_opt = expand(sp_opt)

    ss_res_total = cost_super(sp_opt)
    dof = n_total - n_free
    chi_sq_red = ss_res_total / max(dof, 1)

    # Both estimates, as curve_fit: the selected one fills errors/covar; the
    # unselected Hessian (O(n_free^2) evaluations) only up to 20 free slots.
    err_jtj = np.full(n_super, np.nan)
    err_hess = np.full(n_super, np.nan)
    covar: NDArray[np.float64] | None = None
    if n_free > 0 and dof > 0:
        y_scale = math.sqrt(sum(float(np.sum(w_all[i] * y_all[i] ** 2)) for i in range(k)))
        jac = residual_jacobian(resid_super, sp_opt, slots, super_lb, super_ub, y_scale)
        cov_j = jtj_covariance(jac, chi_sq_red)
        cov_h: NDArray[np.float64] | None = None
        if covariance == "hessian" or n_free <= 20:
            bjac = np.array([_bound_jacobian(float(pf_opt[j]), super_lb[s], super_ub[s])
                             for j, s in enumerate(slots)])
            cov_h = hessian_covariance(_numerical_hessian(cost, pf_opt), chi_sq_red, bjac)
        if cov_j is not None:
            err_jtj[slots] = np.sqrt(np.diag(cov_j))
        if cov_h is not None:
            err_hess[slots] = np.sqrt(np.diag(cov_h))
        cov_free = cov_j if covariance == "jtj" else cov_h
        if cov_free is not None:
            covar = np.zeros((n_super, n_super))
            covar[np.ix_(slots, slots)] = cov_free
    super_err = err_jtj if covariance == "jtj" else err_hess

    lo_all = np.asarray(super_lb, dtype=float)
    hi_all = np.asarray(super_ub, dtype=float)
    stalled = stalled_parameters(cost_super, sp_opt, super_p0, lo_all, hi_all, slots)
    warnings = [f"global parameter slot {s + 1} never moved from its start value "
                f"{super_p0[s]:.6g} although the fit residual still falls along it; "
                "the optimizer stalled -- try another start value" for s in stalled]
    if warnings:
        exit_flag = 0

    params: list[list[float]] = []
    errors: list[list[float]] = []
    residuals: list[NDArray[np.float64]] = []
    y_fit: list[NDArray[np.float64]] = []
    r2 = np.zeros(k)
    rmse = np.zeros(k)
    chi_sq = np.zeros(k)

    def per_dataset(err: NDArray[np.float64]) -> list[list[float]]:
        return [[float(err[super_idx[ki, pi]]) for pi in range(p)] for ki in range(k)]

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
        # One metric definition (calc.fit_metrics): RMSE is UNWEIGHTED, in
        # the units of y, over the points that were fitted; the weighted sum
        # the fit minimised is reported separately as chiSq.
        used = w_all[ki] > 0
        rmse[ki] = math.sqrt(float(np.mean(res_k[used] ** 2))) if bool(np.any(used)) else math.nan
        chi_sq[ki] = ss_res

    shared_out: list[dict[str, Any]] = []
    for g, grp in enumerate(sharing):
        shared_out.append({
            "name": grp["param_name"],
            "paramIdx": grp["param_idx"],
            "datasets": grp["datasets"],
            "value": float(sp_opt[g]),
            "error": float(super_err[g]),
            "errorJtj": float(err_jtj[g]),
            "errorHessian": float(err_hess[g]),
        })

    return {
        "params": params,
        "errors": errors,
        "errorsJtj": per_dataset(err_jtj),
        "errorsHessian": per_dataset(err_hess),
        "shared": shared_out,
        "residuals": residuals,
        "yFit": y_fit,
        "R2": r2,
        "RMSE": rmse,
        "chiSq": chi_sq,
        "chiSqRed": float(chi_sq_red),
        "covar": covar,
        "nTotal": n_total,
        "nFree": n_free,
        "held": [[bool(held[super_idx[ki, pi]]) for pi in range(p)] for ki in range(k)],
        "covariance": covariance,
        "warnings": warnings,
        "exitFlag": exit_flag,
    }


def slot_layout(
    sharing: Sequence[dict[str, Any]], k: int, p: int
) -> tuple[NDArray[np.bool_], NDArray[np.int_], int]:
    """Super-parameter layout: ``(is_shared, super_idx, n_super)``. Shared
    groups take slots ``0..G-1``; every other (dataset, parameter) pair gets
    its own slot after them, dataset-major."""
    is_shared = np.zeros((k, p), dtype=bool)
    super_idx = np.zeros((k, p), dtype=int)
    for g, grp in enumerate(sharing):
        for ki in grp["datasets"]:
            is_shared[ki, grp["param_idx"]] = True
            super_idx[ki, grp["param_idx"]] = g  # shared slots take positions 0..G-1
    nxt = len(sharing)
    for ki in range(k):
        for pi in range(p):
            if not is_shared[ki, pi]:
                super_idx[ki, pi] = nxt
                nxt += 1
    return is_shared, super_idx, nxt


def held_slots(
    fixed: Sequence[Any] | None, k: int, p: int, super_idx: NDArray[np.int_], n_super: int
) -> NDArray[np.bool_]:
    """Per-super-slot held flags from a broadcast or per-dataset ``fixed``.

    A shared slot must be held in every dataset that shares it or in none:
    holding it in one member only has no single meaning, so it is refused.
    """
    held = np.zeros(n_super, dtype=bool)
    if fixed is None:
        return held
    arr = np.asarray(fixed, dtype=bool)
    rows = np.broadcast_to(arr, (k, p)) if arr.ndim == 1 else arr
    if rows.shape != (k, p):
        raise ValueError(f"fixed must be {p} flags or {k} vectors of {p} flags")
    votes: dict[int, set[bool]] = {}
    for ki in range(k):
        for pi in range(p):
            votes.setdefault(int(super_idx[ki, pi]), set()).add(bool(rows[ki, pi]))
    for s, v in votes.items():
        if len(v) > 1:
            raise ValueError("a shared parameter must be held in all of its datasets or in none")
        held[s] = v.pop()
    return held
