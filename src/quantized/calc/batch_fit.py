"""Run the same curve fit across many datasets. Port of fitting.batchFit.

Pure calc layer. Fits one model to each dataset and collects the per-dataset
parameters / errors / fit statistics into a summary for trend analysis (e.g.
fitted τ vs temperature). Reuses the bounded ``curve_fit``; optional per-dataset
auto-guess via a registered model name, x-range restriction, and 1/y or 1/y²
weighting — all matching the MATLAB original.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

from .fit_autoguess import auto_guess
from .fit_models import FIT_MODELS
from .fitting import curve_fit

__all__ = ["batch_fit"]

_EPS = float(np.finfo(float).eps)
ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]


def _extract_xy(
    ds: DataStruct | tuple[Any, Any] | list[Any], channel: int
) -> tuple[NDArray[np.float64], NDArray[np.float64], dict[str, Any] | None]:
    """(x, y, metadata) from a DataStruct or an (x, y) pair."""
    if isinstance(ds, DataStruct):
        x = np.asarray(ds.time, dtype=float).ravel()
        values = np.asarray(ds.values, dtype=float)
        if values.ndim == 2:
            ch = min(channel, values.shape[1] - 1)
            y = values[:, ch]
        else:
            y = values.ravel()
        return x, np.asarray(y, dtype=float).ravel(), dict(ds.metadata)
    if isinstance(ds, (tuple, list)) and len(ds) >= 2:
        return (
            np.asarray(ds[0], dtype=float).ravel(),
            np.asarray(ds[1], dtype=float).ravel(),
            None,
        )
    return np.empty(0), np.empty(0), None


def _clamped_seed(
    seed: NDArray[np.float64],
    p0: Sequence[float],
    lower: Sequence[float] | None,
    upper: Sequence[float] | None,
    fixed: Sequence[bool] | None,
) -> list[float]:
    """The previous fit's parameters as the next start: inside the bounds,
    with every ``fixed`` parameter at its ``p0`` value."""
    lo = np.full(len(p0), -np.inf) if lower is None else np.asarray(lower, dtype=float)
    hi = np.full(len(p0), np.inf) if upper is None else np.asarray(upper, dtype=float)
    out = np.asarray(np.clip(seed, lo, hi), dtype=float)
    if fixed is not None:
        for j, held in enumerate(fixed):
            if held:
                out[j] = float(p0[j])
    return [float(v) for v in out]


def batch_fit(
    datasets: list[Any],
    model_fcn: ModelFn,
    p0: Sequence[float],
    *,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    fixed: Sequence[bool] | None = None,
    channel: int = 0,
    model_name: str = "",
    meta_field: str = "",
    x_range: Sequence[float] | None = None,
    weights: str = "none",
    covariance: str = "jtj",
    seed_from_previous: bool = False,
) -> dict[str, Any]:
    """Fit ``model_fcn`` to every dataset; return a per-dataset summary.

    Port of fitting.batchFit. Each dataset is a ``DataStruct`` or an ``(x, y)``
    pair. ``model_name`` (if registered) drives per-dataset auto-guess and the
    output ``paramNames``. ``weights`` ∈ {``none``, ``1/y``, ``1/y2``}. Returns a
    dict with ``params``/``errors`` (N×M), ``R2``/``chiSqRed``/``RMSE``/``AIC``/
    ``exitFlags``/``metaValues`` (length N, NaN where a fit was skipped/failed),
    ``paramNames``, ``modelName``, ``nDatasets``, ``converged``. ``covariance``
    is passed to ``curve_fit`` (``"hessian"`` reproduces MATLAB's errors).

    ``seed_from_previous`` (default off: every dataset starts from ``p0`` /
    its auto-guess, exactly as before) starts each fit from the previous
    dataset's converged parameters, in the order given (Origin's sequential
    fit). The seed is clamped into ``lower``/``upper`` and a ``fixed``
    parameter keeps its ``p0`` value. The first dataset, and any dataset
    after one that was skipped, failed or did not converge (``exitFlag`` not
    1), starts as it would without the option. ``seeded`` (length N) says
    which fits started from a previous result; ``seedFromPrevious`` echoes
    the option so a saved summary shows the mode.
    """
    if weights not in ("none", "1/y", "1/y2"):
        raise ValueError(f'weights must be "none", "1/y", or "1/y2", got "{weights}"')
    n = len(datasets)
    m = len(p0)
    nan = float("nan")
    params = np.full((n, m), nan)
    errors = np.full((n, m), nan)
    errors_jtj = np.full((n, m), nan)
    errors_hess = np.full((n, m), nan)
    r2 = [nan] * n
    chi_sq_red = [nan] * n
    rmse = [nan] * n
    aic = [nan] * n
    exit_flags = [0] * n
    meta_values = [nan] * n
    seeded = [False] * n
    prev: NDArray[np.float64] | None = None

    for i in range(n):
        seed, prev = prev, None  # any `continue` below leaves no seed behind
        x_data, y_data, meta = _extract_xy(datasets[i], channel)
        if x_data.size < m + 1:
            continue

        if x_range is not None and len(x_range) == 2:
            mask = (x_data >= x_range[0]) & (x_data <= x_range[1])
            x_data, y_data = x_data[mask], y_data[mask]

        w: NDArray[np.float64] | None = None
        if weights == "1/y":
            w = 1.0 / np.maximum(np.abs(y_data), _EPS)
        elif weights == "1/y2":
            w = 1.0 / np.maximum(y_data**2, _EPS)

        p0i: Sequence[float] = p0
        if seed_from_previous and seed is not None:
            p0i = _clamped_seed(seed, p0, lower, upper, fixed)
            seeded[i] = True
        elif model_name:
            try:
                p0i = auto_guess(model_name, x_data, y_data)
            except Exception:  # noqa: BLE001 — fall back to the provided p0
                p0i = p0

        if meta_field and meta is not None:
            val = meta.get(meta_field)
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                meta_values[i] = float(val)

        try:
            r = curve_fit(x_data, y_data, model_fcn, p0i, lower=lower, upper=upper,
                          fixed=fixed, weights=w, covariance=covariance)
        except Exception:  # noqa: BLE001 — a failed fit leaves the NaN row (like MATLAB)
            continue

        params[i, :] = np.asarray(r["params"], dtype=float)
        errors[i, :] = np.asarray(r["errors"], dtype=float)
        errors_jtj[i, :] = np.asarray(r["errorsJtj"], dtype=float)
        errors_hess[i, :] = np.asarray(r["errorsHessian"], dtype=float)
        r2[i] = float(r["R2"])
        chi_sq_red[i] = float(r["chiSqRed"])
        rmse[i] = float(r["RMSE"])
        aic[i] = float(r["AIC"])
        exit_flags[i] = int(r["exitFlag"])
        if seed_from_previous and exit_flags[i] == 1:
            prev = params[i, :].copy()

    if model_name and model_name in FIT_MODELS:
        param_names = list(FIT_MODELS[model_name]["paramNames"])
    else:
        param_names = [f"p{j + 1}" for j in range(m)]

    return {
        "params": params,
        "errors": errors,
        "errorsJtj": errors_jtj,
        "errorsHessian": errors_hess,
        "R2": r2,
        "chiSqRed": chi_sq_red,
        "RMSE": rmse,
        "AIC": aic,
        "exitFlags": exit_flags,
        "paramNames": param_names,
        "modelName": model_name,
        "metaValues": meta_values,
        "nDatasets": n,
        "converged": [flag == 1 for flag in exit_flags],
        "seedFromPrevious": bool(seed_from_previous),
        "seeded": seeded,
    }
