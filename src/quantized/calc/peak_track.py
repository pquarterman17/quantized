"""Track a peak across a series of datasets. Port of fitting.trackPeak.

Pure calc layer. Starting from a seed x-position, fits the nearest peak in each
dataset within a search window; with ``follow=True`` the window recenters on each
fitted position so a drifting peak (e.g. a Bragg reflection shifting with
temperature) stays in view. Uses the bounded single-peak ``curve_fit`` (Gaussian
or Lorentzian) and keeps a fit only when its R² exceeds 0.5.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

from .fitting import curve_fit

__all__ = ["track_peak"]

_FWHM_PER_SIGMA = 2.355  # MATLAB trackPeak uses the rounded constant, not 2*sqrt(2 ln 2)


def _gaussian(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-((x - p[1]) ** 2) / (2.0 * p[2] ** 2)), dtype=float)


def _lorentzian(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] / (1.0 + ((x - p[1]) / p[2]) ** 2), dtype=float)


def _extract_xy(
    ds: DataStruct | tuple[Any, Any] | list[Any], channel: int
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Pull (x, y) from a DataStruct (time / values[:, channel]) or an (x, y) pair."""
    if isinstance(ds, DataStruct):
        x = np.asarray(ds.time, dtype=float).ravel()
        values = np.asarray(ds.values, dtype=float)
        ch = min(channel, values.shape[1] - 1) if values.ndim == 2 else 0
        y = values[:, ch] if values.ndim == 2 else values.ravel()
        return x, np.asarray(y, dtype=float).ravel()
    if isinstance(ds, (tuple, list)) and len(ds) >= 2:
        return (
            np.asarray(ds[0], dtype=float).ravel(),
            np.asarray(ds[1], dtype=float).ravel(),
        )
    return np.empty(0), np.empty(0)


def track_peak(
    datasets: list[Any],
    seed_position: float,
    *,
    channel: int = 0,
    window: float = 0.0,
    shape: str = "gaussian",
    min_height: float = 0.0,
    follow: bool = True,
) -> dict[str, Any]:
    """Track a peak across ``datasets`` from ``seed_position``. Port of trackPeak.

    Each dataset is a ``DataStruct`` or an ``(x, y)`` pair. ``window`` is the
    search half-width in x-units (0 → auto, 5% of the x-range). ``shape`` is
    ``"gaussian"`` or ``"lorentzian"``. Returns per-dataset ``center``/``height``/
    ``fwhm``/``area``/``R2`` (NaN where no acceptable peak was found), ``found``
    flags, and ``nDatasets``. ``channel`` is 0-based (MATLAB's is 1-based).
    """
    if shape not in ("gaussian", "lorentzian"):
        raise ValueError(f'shape must be "gaussian" or "lorentzian", got "{shape}"')
    n = len(datasets)
    nan = float("nan")
    center = [nan] * n
    height = [nan] * n
    fwhm = [nan] * n
    area = [nan] * n
    r2 = [nan] * n
    found = [False] * n

    current_pos = float(seed_position)
    model = _gaussian if shape == "gaussian" else _lorentzian

    for i in range(n):
        x_data, y_data = _extract_xy(datasets[i], channel)
        if x_data.size < 5:
            continue

        hw = window if window > 0 else 0.05 * (float(np.max(x_data)) - float(np.min(x_data)))
        mask = (x_data >= current_pos - hw) & (x_data <= current_pos + hw)
        x_seg, y_seg = x_data[mask], y_data[mask]
        if x_seg.size < 5:
            continue

        peak_idx = int(np.argmax(y_seg))
        peak_h, peak_x = float(y_seg[peak_idx]), float(x_seg[peak_idx])
        if peak_h < min_height:
            continue

        p0 = [peak_h, peak_x, hw / 3.0]
        lower = [0.0, current_pos - hw, 0.0]
        upper = [math.inf, current_pos + hw, hw]
        try:
            r = curve_fit(x_seg, y_seg, model, p0, lower=lower, upper=upper, calc_errors=False)
        except (ValueError, FloatingPointError, np.linalg.LinAlgError):
            continue

        if r["R2"] <= 0.5:
            continue
        params = r["params"]
        center[i] = float(params[1])
        height[i] = float(params[0])
        w = abs(float(params[2]))
        if shape == "gaussian":
            fwhm[i] = _FWHM_PER_SIGMA * w
            area[i] = float(params[0]) * w * math.sqrt(2.0 * math.pi)
        else:
            fwhm[i] = 2.0 * w
            area[i] = float(params[0]) * math.pi * w
        r2[i] = float(r["R2"])
        found[i] = True
        if follow:
            current_pos = center[i]

    return {
        "center": center,
        "height": height,
        "fwhm": fwhm,
        "area": area,
        "R2": r2,
        "found": found,
        "nDatasets": n,
    }
