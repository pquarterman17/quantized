"""Finite-row selection and explicit grid alignment for spectral workflows."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct


def selected_arrays(
    ds: DataStruct,
    channels: list[int],
    x_min: float | None,
    x_max: float | None,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if not channels:
        raise ValueError("select at least one signal channel")
    if len(set(channels)) != len(channels):
        raise ValueError("signal channels must be unique")
    if any(
        isinstance(c, (bool, np.bool_))
        or not isinstance(c, (int, np.integer))
        or c < 0
        or c >= ds.n_channels
        for c in channels
    ):
        raise ValueError(f"signal channel out of range for {ds.n_channels} columns")
    x = np.asarray(ds.time, dtype=float)
    y = np.asarray(ds.values[:, channels], dtype=float)
    mask = np.isfinite(x) & np.all(np.isfinite(y), axis=1)
    if x_min is not None:
        mask &= x >= x_min
    if x_max is not None:
        mask &= x <= x_max
    x = x[mask]
    y = y[mask]
    if x.size < 4:
        raise ValueError("need at least 4 finite rows in the selected X range")
    return x, y


def uniform_grid(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    resample: bool,
) -> tuple[NDArray[np.float64], NDArray[np.float64], bool]:
    dx = np.diff(x)
    ascending = bool(np.all(dx > 0))
    descending = bool(np.all(dx < 0))
    if not ascending and not descending:
        raise ValueError(
            "X must be strictly monotonic for spectral analysis; "
            "split closed or repeated sweeps first"
        )
    if descending:
        x = x[::-1]
        y = y[::-1]
        dx = -dx[::-1]
    spacing = float(np.median(dx))
    uniform = bool(np.allclose(dx, spacing, rtol=1e-3, atol=max(abs(spacing) * 1e-9, 1e-15)))
    if uniform:
        return x, y, False
    if not resample:
        spread = float(np.max(np.abs(dx - spacing)) / abs(spacing))
        raise ValueError(
            f"X spacing is not uniform (maximum relative deviation {spread:.3g}); "
            "enable resampling explicitly"
        )
    grid = np.linspace(float(x[0]), float(x[-1]), x.size)
    values = np.column_stack([np.interp(grid, x, y[:, col]) for col in range(y.shape[1])])
    return np.asarray(grid, dtype=float), np.asarray(values, dtype=float), True


def aligned_correlation_arrays(
    left_ds: DataStruct,
    left_channel: int,
    right_ds: DataStruct,
    right_channel: int,
    *,
    x_min: float | None,
    x_max: float | None,
    resample: bool,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], bool]:
    """Return two signals on one explicit, shared grid.

    Different worksheets often have different missing rows or acquisition
    grids. Correlating row positions would be scientifically wrong, so a
    mismatch is refused unless the caller explicitly opts into interpolation.
    The coarser median spacing is used to avoid manufacturing resolution.
    """
    left_x, left_y = selected_arrays(left_ds, [left_channel], x_min, x_max)
    right_x, right_y = selected_arrays(right_ds, [right_channel], x_min, x_max)
    left_x, left_y, left_resampled = uniform_grid(left_x, left_y, resample=resample)
    right_x, right_y, right_resampled = uniform_grid(right_x, right_y, resample=resample)
    lo = max(float(left_x[0]), float(right_x[0]))
    hi = min(float(left_x[-1]), float(right_x[-1]))
    if hi <= lo:
        raise ValueError("the two X ranges do not overlap")
    left_mask = (left_x >= lo) & (left_x <= hi)
    right_mask = (right_x >= lo) & (right_x <= hi)
    lx, rx = left_x[left_mask], right_x[right_mask]
    ly, ry = left_y[left_mask, 0], right_y[right_mask, 0]
    same_grid = lx.size == rx.size and lx.size >= 4 and np.allclose(
        lx, rx, rtol=1e-9, atol=max(abs(hi - lo) * 1e-12, 1e-15)
    )
    if same_grid:
        return lx, ly, ry, left_resampled or right_resampled
    if not resample:
        raise ValueError("the two X grids differ; enable resampling explicitly")
    spacing = max(float(np.median(np.diff(left_x))), float(np.median(np.diff(right_x))))
    count = int(np.floor((hi - lo) / spacing)) + 1
    if count < 4:
        raise ValueError("the overlapping X range needs at least 4 aligned rows")
    grid = lo + np.arange(count, dtype=float) * spacing
    return (
        grid,
        np.interp(grid, left_x, left_y[:, 0]),
        np.interp(grid, right_x, right_y[:, 0]),
        True,
    )
