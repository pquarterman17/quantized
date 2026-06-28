"""Multi-dataset aggregation utilities (confidence / spread bands).

Pure calc layer: operates on :class:`DataStruct` inputs, no fastapi/pydantic
imports. Distinct from ``calc.stats`` (single-vector statistics) — these
functions combine *several* datasets onto a shared grid.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.interpolate import PchipInterpolator

from ..datastruct import DataStruct
from .resample import _interp_column, _sanitize_xy

__all__ = ["confidence_band", "dataset_algebra"]


def confidence_band(
    datasets: list[DataStruct],
    *,
    method: str = "mean",
    channel: int = 0,
    n_points: int = 0,
) -> dict[str, Any]:
    """Pointwise confidence/spread band across N datasets. Port of confidenceBand.

    Each dataset is pchip-interpolated onto a shared grid spanning the
    *overlapping* x-range (``max`` of the per-set minima to ``min`` of the
    maxima), then reduced column-wise:

    - ``method='mean'``  : center = nanmean, band = center +/- sample std (ddof=1)
    - ``method='median'``: center = nanmedian, band = [p25, p75], spread = IQR/2

    ``channel`` is 0-based (MATLAB ``Channel`` is 1-based) and clamped to the last
    channel. Percentiles use the Hazen plotting position ``(i-0.5)/n`` to match
    MATLAB ``prctile``. ``n_points=0`` uses the longest input length.
    """
    if method not in ("mean", "median"):
        raise ValueError("method must be mean/median")
    n_sets = len(datasets)
    if n_sets < 2:
        raise ValueError(f"need at least 2 datasets, got {n_sets}")

    x_min, x_max, max_len = -np.inf, np.inf, 0
    for ds in datasets:
        xi = np.asarray(ds.time, dtype=float)
        if not np.isfinite(xi).any():
            continue  # a fully non-finite x axis contributes no overlap
        x_min = max(x_min, float(np.nanmin(xi)))
        x_max = min(x_max, float(np.nanmax(xi)))
        max_len = max(max_len, int(xi.size))
    if not np.isfinite([x_min, x_max]).all() or x_min >= x_max:
        raise ValueError("datasets have no overlapping x-range")

    n_pts = n_points if n_points > 0 else max_len
    x_common = np.linspace(x_min, x_max, n_pts)
    y_matrix = np.full((n_pts, n_sets), np.nan)
    for i, ds in enumerate(datasets):
        xi = np.asarray(ds.time, dtype=float)
        vals = np.asarray(ds.values, dtype=float)
        ch = min(channel, vals.shape[1] - 1)
        # Sanitize first (drop non-finite, sort, average duplicate x): pchip
        # rejects NaN and non-strictly-increasing x. No-op on clean data.
        xs, ys = _sanitize_xy(xi, vals[:, ch])
        if xs.size < 2:
            continue  # fewer than 2 finite points — leave this set's column NaN
        interp = PchipInterpolator(xs, ys, extrapolate=False)
        y_matrix[:, i] = interp(x_common)

    if method == "mean":
        center = np.nanmean(y_matrix, axis=1)
        spread = np.nanstd(y_matrix, axis=1, ddof=1)
        upper = center + spread
        lower = center - spread
    else:  # median
        center = np.nanmedian(y_matrix, axis=1)
        q25 = np.nanpercentile(y_matrix, 25, axis=1, method="hazen")
        q75 = np.nanpercentile(y_matrix, 75, axis=1, method="hazen")
        upper, lower = q75, q25
        spread = (q75 - q25) / 2.0

    return {
        "x": x_common,
        "center": center,
        "upper": upper,
        "lower": lower,
        "spread": spread,
        "method": method,
        "nSets": n_sets,
    }


_ALGEBRA_OPS = ("A+B", "A-B", "A*B", "A/B", "(A-B)/(A+B)")


def _safe_label(ds: DataStruct, ch: int) -> str:
    return ds.labels[ch] if ch < len(ds.labels) else f"ch{ch + 1}"


def _safe_unit(ds: DataStruct, ch: int) -> str:
    return ds.units[ch] if ch < len(ds.units) else ""


def dataset_algebra(
    ds_a: DataStruct,
    ds_b: DataStruct,
    operation: str,
    *,
    interp_method: str = "pchip",
    channel_a: int = 0,
    channel_b: int = 0,
) -> DataStruct:
    """Combine two datasets pointwise on A's x-grid. Port of utilities.datasetAlgebra.

    B is interpolated onto A's time axis (``interp_method`` = pchip/linear/spline,
    NaN outside B's range) and combined via ``operation`` (``A+B``, ``A-B``,
    ``A*B``, ``A/B``, ``(A-B)/(A+B)``). Division/asymmetry guard zeros with NaN.
    ``channel_a``/``channel_b`` are 0-based and clamped to the last channel.
    """
    if operation not in _ALGEBRA_OPS:
        raise ValueError(f"operation must be one of {_ALGEBRA_OPS}")
    xa = np.asarray(ds_a.time, dtype=float).ravel()
    xb = np.asarray(ds_b.time, dtype=float).ravel()
    va = np.asarray(ds_a.values, dtype=float)
    vb = np.asarray(ds_b.values, dtype=float)
    ch_a = min(channel_a, va.shape[1] - 1)
    ch_b = min(channel_b, vb.shape[1] - 1)
    ya = va[:, ch_a]
    yb = _interp_column(xb, vb[:, ch_b], xa, interp_method, False)

    la, lb = _safe_label(ds_a, ch_a), _safe_label(ds_b, ch_b)
    unit_a = _safe_unit(ds_a, ch_a)
    if operation == "A+B":
        y_result, label, unit = ya + yb, f"{la} + {lb}", unit_a
    elif operation == "A-B":
        y_result, label, unit = ya - yb, f"{la} - {lb}", unit_a
    elif operation == "A*B":
        y_result, label, unit = ya * yb, f"{la} × {lb}", f"{unit_a}²"
    elif operation == "A/B":
        with np.errstate(divide="ignore", invalid="ignore"):
            y_result = ya / yb
        y_result[yb == 0] = np.nan
        label, unit = f"{la} / {lb}", "ratio"
    else:  # (A-B)/(A+B)
        denom = ya + yb
        with np.errstate(divide="ignore", invalid="ignore"):
            y_result = (ya - yb) / denom
        y_result[denom == 0] = np.nan
        label = f"({la} - {lb}) / ({la} + {lb})"
        unit = "asymmetry"

    meta: dict[str, Any] = {}
    if "source" in ds_a.metadata:
        meta["source"] = ds_a.metadata["source"]
    meta["operation"] = operation
    return DataStruct.create(xa, y_result, labels=[label], units=[unit], metadata=meta)
