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

__all__ = ["confidence_band"]


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
        x_min = max(x_min, float(xi.min()))
        x_max = min(x_max, float(xi.max()))
        max_len = max(max_len, int(xi.size))
    if x_min >= x_max:
        raise ValueError("datasets have no overlapping x-range")

    n_pts = n_points if n_points > 0 else max_len
    x_common = np.linspace(x_min, x_max, n_pts)
    y_matrix = np.full((n_pts, n_sets), np.nan)
    for i, ds in enumerate(datasets):
        xi = np.asarray(ds.time, dtype=float)
        vals = np.asarray(ds.values, dtype=float)
        ch = min(channel, vals.shape[1] - 1)
        order = np.argsort(xi, kind="stable")
        interp = PchipInterpolator(xi[order], vals[order, ch], extrapolate=False)
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
