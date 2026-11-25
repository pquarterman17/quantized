"""Classical seasonal decomposition (GAP_AUDIT_9 G13).

Additive y = T + S + R or multiplicative y = T * S * R with a user-given
period m (Hyndman & Athanasopoulos, *Forecasting: Principles and Practice*,
3rd ed., section 3.4 "Classical decomposition"; the same algorithm as R
``decompose`` and statsmodels ``seasonal_decompose``):

1. trend T: a centred moving average of order m (a 2 x m average when m is
   even); undefined for the first and last m // 2 points;
2. detrended = y - T (or y / T); the seasonal figure of each position in the
   cycle is the mean of its detrended values, then centred (additive: sum of
   the figure is 0; multiplicative: mean of the figure is 1);
3. remainder R = y - T - S (or y / (T S)).

The cycle starts at the first sample (position 0). The undefined end values
are NaN (``None`` on the wire); nothing is extrapolated.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["decompose"]


def _moving_average(y: NDArray[np.float64], m: int) -> NDArray[np.float64]:
    n = y.size
    if m % 2 == 1:
        kernel = np.full(m, 1.0 / m)
    else:
        kernel = np.full(m + 1, 1.0 / m)
        kernel[0] = kernel[-1] = 0.5 / m
    half = kernel.size // 2
    out = np.full(n, np.nan)
    out[half : n - half] = np.convolve(y, kernel, mode="valid")
    return out


def decompose(y: NDArray[np.float64], period: int, model: str = "additive") -> dict[str, Any]:
    if model not in ("additive", "multiplicative"):
        raise ValueError("model must be 'additive' or 'multiplicative'")
    y = np.asarray(y, dtype=float)
    n = y.size
    if period < 2:
        raise ValueError("period must be at least 2 samples")
    if n < 2 * period:
        raise ValueError(f"need at least two full periods ({2 * period} points), got {n}")
    if model == "multiplicative" and np.any(y <= 0.0):
        raise ValueError("a multiplicative model needs strictly positive values; use additive")
    trend = _moving_average(y, period)
    detrended = y - trend if model == "additive" else y / trend
    figure = np.array([np.nanmean(detrended[i::period]) for i in range(period)])
    figure = figure - figure.mean() if model == "additive" else figure / figure.mean()
    seasonal = np.resize(figure, n)
    resid = y - trend - seasonal if model == "additive" else y / (trend * seasonal)
    ok = np.isfinite(resid)
    ss_resid = float(np.sum((resid[ok] - (0.0 if model == "additive" else 1.0)) ** 2))
    # Share of the (trend-removed) variation the seasonal component explains.
    ss_detr = float(np.sum((detrended[ok] - np.mean(detrended[ok])) ** 2))
    strength = None if ss_detr <= 0.0 else max(0.0, 1.0 - ss_resid / ss_detr)
    return {
        "model": model,
        "period": period,
        "n": n,
        "trend": trend.tolist(),
        "seasonal": seasonal.tolist(),
        "residual": resid.tolist(),
        "seasonal_figure": figure.tolist(),
        "seasonal_strength": strength,
    }
