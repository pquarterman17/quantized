"""Resample a DataStruct onto a new x-grid. Port of utilities.resampleData.

Pure calc layer. Supports four grid modes (n_points / step / grid / match_dataset;
exactly one, or none for a 500-point default) and four interpolation methods
(linear / pchip / spline=not-a-knot / makima). Out-of-range samples are NaN unless
``extrapolate=True``.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.interpolate import (
    Akima1DInterpolator,
    CubicSpline,
    PchipInterpolator,
    interp1d,
)

from ..cat_levels import surviving_cat_levels
from ..datastruct import DataStruct
from ..row_sidecars import drop_row_sidecars

__all__ = ["resample_data"]

_METHODS = ("linear", "pchip", "spline", "makima")


def _colon(a: float, d: float, b: float) -> NDArray[np.float64]:
    """MATLAB ``a:d:b`` colon grid (endpoint included only if it lands exactly)."""
    if d == 0:
        raise ValueError("resample step must be non-zero")
    n = int(math.floor((b - a) / d + 1e-10))
    return np.asarray(a + np.arange(n + 1) * d, dtype=float)


def _sanitize_xy(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Make ``(x, y)`` safe for interpolation: drop non-finite pairs, sort by x,
    and collapse duplicate x (mean y). Mirrors MATLAB ``interp1``'s effective
    tolerance (it ignores NaN values and accepts unsorted input). Every step is
    guarded, so clean, strictly-increasing, finite data passes through untouched
    — golden parity is preserved; only real-world data (NaN gaps, hysteresis /
    unsorted sweeps, step profiles with repeated x) is repaired."""
    finite = np.isfinite(x) & np.isfinite(y)
    if not bool(finite.all()):
        x, y = x[finite], y[finite]
    if x.size > 1 and not bool(np.all(np.diff(x) > 0)):
        order = np.argsort(x, kind="stable")
        x, y = x[order], y[order]
        if bool((x[1:] == x[:-1]).any()):
            ux, inv = np.unique(x, return_inverse=True)
            sums = np.zeros(ux.size)
            cnts = np.zeros(ux.size)
            np.add.at(sums, inv, y)
            np.add.at(cnts, inv, 1.0)
            x, y = ux, sums / cnts
    return x, y


def _interp_column(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    x_new: NDArray[np.float64],
    method: str,
    extrapolate: bool,
) -> NDArray[np.float64]:
    x, y = _sanitize_xy(x, y)
    if x.size < 2:
        # Too few finite points to interpolate — undefined everywhere.
        return np.full(np.shape(x_new), np.nan, dtype=float)
    if method == "linear":
        if extrapolate:
            fn = interp1d(x, y, kind="linear", fill_value="extrapolate", assume_sorted=True)
            return np.asarray(fn(x_new), dtype=float)
        return np.asarray(np.interp(x_new, x, y, left=np.nan, right=np.nan), dtype=float)
    if method == "pchip":
        return np.asarray(PchipInterpolator(x, y, extrapolate=extrapolate)(x_new), dtype=float)
    if method == "spline":
        spline = CubicSpline(x, y, bc_type="not-a-knot", extrapolate=extrapolate)
        return np.asarray(spline(x_new), dtype=float)
    akima = Akima1DInterpolator(x, y, method="makima", extrapolate=extrapolate)
    return np.asarray(akima(x_new), dtype=float)


def resample_data(
    data: DataStruct,
    *,
    n_points: int | None = None,
    step: float | None = None,
    grid: ArrayLike | None = None,
    match_dataset: DataStruct | None = None,
    method: str = "makima",
    extrapolate: bool = False,
) -> DataStruct:
    """Resample ``data`` onto a new x-grid, interpolating every channel.

    Specify exactly one grid mode (``n_points``, ``step``, ``grid`` or
    ``match_dataset``); with none, a 500-point linspace over the data range is
    used. Returns a new DataStruct with ``resampled``/``resampleMethod``/
    ``resamplePoints`` stamped into ``metadata``.
    """
    if method not in _METHODS:
        raise ValueError(f"method must be one of {_METHODS}")
    x_old = np.asarray(data.time, dtype=float).ravel()
    y_old = np.asarray(data.values, dtype=float)
    if y_old.ndim == 1:
        y_old = y_old.reshape(-1, 1)
    if x_old.size < 2:
        raise ValueError("need at least 2 data points")

    modes = sum(v is not None for v in (n_points, step, grid, match_dataset))
    if modes > 1:
        raise ValueError("specify only one of: n_points, step, grid, match_dataset")
    # MATLAB min/max ignore NaN; mirror that so a NaN in the x axis doesn't
    # collapse the auto-grid to all-NaN. No-op on clean data (golden parity).
    if not np.isfinite(x_old).any():
        raise ValueError("x axis has no finite values")
    lo, hi = float(np.nanmin(x_old)), float(np.nanmax(x_old))
    if modes == 0:
        x_new = np.linspace(lo, hi, 500)
    elif n_points is not None:
        x_new = np.linspace(lo, hi, int(n_points))
    elif step is not None:
        x_new = _colon(lo, float(step), hi)
    elif grid is not None:
        x_new = np.asarray(grid, dtype=float).ravel()
    else:  # match_dataset
        x_new = np.asarray(match_dataset.time, dtype=float).ravel()  # type: ignore[union-attr]

    y_new = np.empty((x_new.size, y_old.shape[1]))
    for c in range(y_old.shape[1]):
        y_new[:, c] = _interp_column(x_old, y_old[:, c], x_new, method, extrapolate)

    # BUG-006: the row-indexed metadata sidecars are DROPPED, not sliced. Every
    # output row is an INTERPOLATED point on a new x grid, so no output row IS
    # any input row and there is no index mapping to slice to -- exactly the
    # reasoning that already governs `cat_levels` below. A per-row text cell
    # carried onto a row it cannot describe is worse than not carrying it.
    meta = drop_row_sidecars(data.metadata)
    meta["resampled"] = True
    meta["resampleMethod"] = method
    meta["resamplePoints"] = int(x_new.size)
    # `cat_levels` survives only where the codes did (BUG-005). Resampling
    # INTERPOLATES, so a categorical channel's integer level codes normally
    # become fractional and index nothing — carrying the table forward would
    # attach labels to values that cannot have them, which is why this dropped it
    # outright. But a resample onto a COINCIDENT grid returns its input
    # unchanged, and there the table still describes the output exactly.
    # `surviving_cat_levels` decides per channel by comparing the numbers, so the
    # drop still happens whenever interpolation actually moved them.
    #
    # GATED ON A GENUINELY COINCIDENT GRID (review MEDIUM 4). Without the
    # `array_equal(x_old, x_new)` test the keep also fired on a BRAND-NEW grid
    # whenever interpolation happened to reproduce the codes — measured on a
    # constant column (`grid=[0.5, 1.0, 1.5]`) and on a step-like one whose new
    # points all landed inside flat regions. Those codes are valid, so it was not
    # a wrong label; but it silently SETTLED the refuse-vs-nearest-neighbour
    # product decision that is still booked, by shipping a third answer. Every
    # comment and test here described the keep as coincident-grid-only, so the
    # code now is.
    #
    # STILL BOOKED as BUG-005: what Resample SHOULD do with a categorical channel
    # on a genuinely new grid (refuse, or nearest-neighbour it) is a product
    # decision, not something to settle here.
    return DataStruct.create(
        x_new,
        y_new,
        labels=data.labels,
        units=data.units,
        metadata=meta,
        cat_levels=(
            surviving_cat_levels(data.cat_levels, y_old, y_new)
            if np.array_equal(x_old, x_new)
            else None
        ),
    )
