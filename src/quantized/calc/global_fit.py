"""Global (shared-parameter) fitting across datasets. Port of fitting.globalFit.

Pure calc layer. Fits one model to N datasets in a single optimization where some
parameters are shared (one value across all datasets) and the rest are free per
dataset. Builds a super-parameter vector ``[shared…, ds0 free…, ds1 free…, …]``,
a joint objective over the concatenated data, and the bounded ``curve_fit`` solves
it; results are unpacked back into per-dataset full parameter vectors. The classic
global-analysis framework (Beechem, Methods Enzymol. 210, 37 (1992)).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

from .fitting import curve_fit

__all__ = ["global_fit"]

_EPS = float(np.finfo(float).eps)
ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def _extract_xy(
    ds: DataStruct | tuple[Any, Any] | list[Any], channel: int
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if isinstance(ds, DataStruct):
        x = np.asarray(ds.time, dtype=float).ravel()
        values = np.asarray(ds.values, dtype=float)
        if values.ndim == 2:
            y = values[:, min(channel, values.shape[1] - 1)]
        else:
            y = values.ravel()
        return x, np.asarray(y, dtype=float).ravel()
    if isinstance(ds, (tuple, list)) and len(ds) >= 2:
        return np.asarray(ds[0], dtype=float).ravel(), np.asarray(ds[1], dtype=float).ravel()
    return np.empty(0), np.empty(0)


def global_fit(
    datasets: list[Any],
    model_fcn: ModelFn,
    p0: Sequence[float],
    shared_mask: Sequence[bool],
    *,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    channel: int = 0,
    weights: str = "none",
) -> dict[str, Any]:
    """Fit ``datasets`` simultaneously with shared/per-dataset parameters.

    Port of fitting.globalFit. ``shared_mask[j]`` True → parameter ``j`` is shared
    across all datasets; False → free per dataset. ``p0``/``lower``/``upper`` are
    length-M (one dataset). ``weights`` ∈ {``none``, ``1/y``, ``1/y2``}. Returns a
    dict with ``sharedParams``/``sharedErrors``, ``perDataset``/``perErrors`` (N×M),
    per-dataset ``R2`` + ``residuals``, ``R2global``, ``chiSqRed``, ``exitFlag``,
    ``nParams``, ``nDatasets``, ``sharedMask``.
    """
    if weights not in ("none", "1/y", "1/y2"):
        raise ValueError(f'weights must be "none", "1/y", or "1/y2", got "{weights}"')
    m = len(p0)
    n = len(datasets)
    if len(shared_mask) != m:
        raise ValueError(f"shared_mask must have {m} elements")

    mask = np.asarray(shared_mask, dtype=bool)
    shared_idx = np.flatnonzero(mask)
    free_idx = np.flatnonzero(~mask)
    n_shared = int(shared_idx.size)
    n_free = int(free_idx.size)
    p0v = np.asarray(p0, dtype=float)

    x_all: list[NDArray[np.float64]] = []
    y_all: list[NDArray[np.float64]] = []
    w_all: list[NDArray[np.float64]] = []
    n_pts: list[int] = []
    for ds in datasets:
        xi, yi = _extract_xy(ds, channel)
        x_all.append(xi)
        y_all.append(yi)
        n_pts.append(xi.size)
        if weights == "1/y":
            w_all.append(1.0 / np.maximum(np.abs(yi), _EPS))
        elif weights == "1/y2":
            w_all.append(1.0 / np.maximum(yi**2, _EPS))
        else:
            w_all.append(np.ones(xi.size))
    total_pts = int(sum(n_pts))

    # Super-parameter vector: [shared…, ds0 free…, ds1 free…, …]
    n_super = n_shared + n * n_free
    super_p0 = np.zeros(n_super)
    super_p0[:n_shared] = p0v[shared_idx]
    for i in range(n):
        off = n_shared + i * n_free
        super_p0[off : off + n_free] = p0v[free_idx]

    super_lb = np.full(n_super, -np.inf)
    super_ub = np.full(n_super, np.inf)
    if lower is not None:
        lo = np.asarray(lower, dtype=float)
        super_lb[:n_shared] = lo[shared_idx]
        for i in range(n):
            off = n_shared + i * n_free
            super_lb[off : off + n_free] = lo[free_idx]
    if upper is not None:
        up = np.asarray(upper, dtype=float)
        super_ub[:n_shared] = up[shared_idx]
        for i in range(n):
            off = n_shared + i * n_free
            super_ub[off : off + n_free] = up[free_idx]

    def _full_params(sp: NDArray[np.float64], di: int) -> NDArray[np.float64]:
        p_full = np.zeros(m)
        p_full[shared_idx] = sp[:n_shared]
        off = n_shared + di * n_free
        p_full[free_idx] = sp[off : off + n_free]
        return p_full

    def super_model(_x: NDArray[np.float64], sp: NDArray[np.float64]) -> NDArray[np.float64]:
        # _x is the concatenated grid (ignored — each segment uses its own x_all).
        y_pred = np.zeros(total_pts)
        pos = 0
        for di in range(n):
            y_pred[pos : pos + n_pts[di]] = model_fcn(x_all[di], _full_params(sp, di))
            pos += n_pts[di]
        return y_pred

    x_concat = np.concatenate(x_all) if x_all else np.empty(0)
    y_concat = np.concatenate(y_all) if y_all else np.empty(0)
    w_concat = np.concatenate(w_all) if w_all else np.empty(0)

    fit = curve_fit(
        x_concat, y_concat, super_model, super_p0.tolist(),
        lower=super_lb.tolist(), upper=super_ub.tolist(), weights=w_concat, calc_errors=True,
    )
    sp_opt = np.asarray(fit["params"], dtype=float)
    sp_err = np.asarray(fit["errors"], dtype=float)

    shared_params = sp_opt[:n_shared]
    shared_errors = sp_err[:n_shared]
    per_dataset = np.zeros((n, m))
    per_errors = np.zeros((n, m))
    residuals: list[NDArray[np.float64]] = []
    r2_per = np.zeros(n)
    for i in range(n):
        p_full = np.zeros(m)
        e_full = np.zeros(m)
        p_full[shared_idx] = shared_params
        e_full[shared_idx] = shared_errors
        off = n_shared + i * n_free
        p_full[free_idx] = sp_opt[off : off + n_free]
        e_full[free_idx] = sp_err[off : off + n_free]
        per_dataset[i, :] = p_full
        per_errors[i, :] = e_full
        res = y_all[i] - model_fcn(x_all[i], p_full)
        residuals.append(np.asarray(res, dtype=float))
        ss_tot = float(np.sum((y_all[i] - np.mean(y_all[i])) ** 2))
        ss_res = float(np.sum(res**2))
        r2_per[i] = 1.0 - ss_res / max(ss_tot, _EPS)

    return {
        "sharedParams": shared_params,
        "sharedErrors": shared_errors,
        "perDataset": per_dataset,
        "perErrors": per_errors,
        "R2": r2_per,
        "R2global": float(fit["R2"]),
        "chiSqRed": float(fit["chiSqRed"]),
        "residuals": residuals,
        "nDatasets": n,
        "sharedMask": mask.tolist(),
        "exitFlag": int(fit["exitFlag"]),
        "nParams": n_super,
    }
