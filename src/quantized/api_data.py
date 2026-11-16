"""The app's data operations with one calling convention, for
:mod:`quantized.api` (gap audit 5, item 6).

Every function takes a :class:`DataStruct` first and its options by keyword,
and returns a new DataStruct (``resample`` an ``AlignResult``: ``.data`` plus
the warnings the app shows). ``channels`` (0-based) picks the columns to
transform; by default every numeric column (categorical columns are level
codes and are never transformed). Untouched columns pass through unchanged.

The maths is the app's own, unchanged: smoothing, derivatives, the integral
and normalization are the golden-tested MATLAB ports in ``calc/processing.py``
(the same functions the correction pipeline calls, with the same unit rules:
dY/dX is ``unit/x_unit``, the integral ``unit*x_unit``); the filters are
``calc/signal_ops.run_signal_op``, which also names the output columns the
way the app does (``"M · median(5)"``) and returns ONLY the filtered columns,
as the app's Signal Processing transform does; ``resample`` is the app's
resample transform (``calc/resample_align.align_resample``).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc import processing
from quantized.calc.resample_align import AlignResult, align_resample
from quantized.calc.signal_ops import run_signal_op
from quantized.calc.transform_units import unit_product, unit_quotient
from quantized.datastruct import DataStruct
from quantized.x_units import x_unit_of

__all__ = [
    "cumulative_integral",
    "derivative",
    "despike",
    "hilbert_envelope",
    "log_derivative",
    "lowess",
    "median_filter",
    "normalize",
    "resample",
    "smooth",
]

Mat = NDArray[np.float64]


def _channels(data: DataStruct, channels: Sequence[int] | None) -> list[int]:
    cat = set(data.cat_levels or ())
    if channels is None:
        return [c for c in range(data.n_channels) if c not in cat]
    out = [int(c) for c in channels]
    bad = [c for c in out if not 0 <= c < data.n_channels]
    if bad:
        raise ValueError(f"no such column: {bad[0]}")
    if any(c in cat for c in out):
        raise ValueError("a categorical column holds level codes and cannot be transformed")
    return out


def _apply(
    data: DataStruct,
    channels: Sequence[int] | None,
    fn: Callable[[Mat], Mat],
    unit: Callable[[str], str] | None = None,
) -> DataStruct:
    chans = _channels(data, channels)
    values = np.array(data.values, dtype=float)
    units = list(data.units)
    if chans:
        values[:, chans] = np.asarray(fn(values[:, chans]), dtype=float).reshape(len(values), -1)
        if unit is not None:
            for c in chans:
                units[c] = unit(units[c])
    return DataStruct.create(
        data.time, values, labels=data.labels, units=units, metadata=data.metadata,
        cat_levels=data.cat_levels, level_order=data.level_order,
    )  # fmt: skip


def smooth(
    data: DataStruct,
    *,
    method: str = "moving",
    window: int = 5,
    poly_order: int = 2,
    channels: Sequence[int] | None = None,
) -> DataStruct:
    """Smooth columns: ``"moving"``, ``"gaussian"`` or ``"savitzky-golay"``;
    ``window`` is the half-width (the full window is ``2*window + 1``)."""
    return _apply(
        data,
        channels,
        lambda m: processing.smooth_data(m, method=method, window=window, poly_order=poly_order),
    )


def derivative(
    data: DataStruct, *, order: int = 1, pre_smooth: int = 0, channels: Sequence[int] | None = None
) -> DataStruct:
    """dY/dX (``order=1``) or d2Y/dX2 (``order=2``) against X, MATLAB's
    ``gradient``; units become ``unit/x_unit`` (squared for order 2)."""
    x, xu = np.asarray(data.time, dtype=float), x_unit_of(data)
    return _apply(
        data,
        channels,
        lambda m: processing.derivative(x, m, order=order, pre_smooth=pre_smooth),
        lambda u: unit_quotient(u, xu, order) if order == 2 else unit_quotient(u, xu),
    )


def log_derivative(data: DataStruct, *, channels: Sequence[int] | None = None) -> DataStruct:
    """(x/y) dy/dx; NaN where x or y is not positive. Dimensionless."""
    x = np.asarray(data.time, dtype=float)
    return _apply(data, channels, lambda m: processing.log_derivative(x, m), lambda _u: "")


def cumulative_integral(data: DataStruct, *, channels: Sequence[int] | None = None) -> DataStruct:
    """The running trapezoid integral against X (starts at 0); units become
    ``unit*x_unit``."""
    x, xu = np.asarray(data.time, dtype=float), x_unit_of(data)
    return _apply(
        data, channels, lambda m: processing.cumulative_integral(x, m),
        lambda u: unit_product(u, xu),
    )  # fmt: skip


def normalize(
    data: DataStruct,
    *,
    method: str = "range",
    out_range: tuple[float, float] = (0.0, 1.0),
    channels: Sequence[int] | None = None,
) -> DataStruct:
    """Per column: ``"range"`` (onto ``out_range``), ``"peak"`` (by the
    largest magnitude) or ``"zscore"``."""
    return _apply(
        data, channels, lambda m: processing.normalize(m, method=method, out_range=out_range)
    )


def _sigop(
    data: DataStruct, method: str, channels: Sequence[int] | None, **args: Any
) -> DataStruct:
    return run_signal_op(data, method, _channels(data, channels), args).data


def median_filter(
    data: DataStruct, *, window: int = 5, channels: Sequence[int] | None = None
) -> DataStruct:
    """Running median over ``window`` rows, in row order (the app's Median filter)."""
    return _sigop(data, "median", channels, window=window)


def despike(
    data: DataStruct,
    *,
    window: int = 7,
    threshold: float = 5.0,
    channels: Sequence[int] | None = None,
) -> DataStruct:
    """Replace points more than ``threshold`` MADs from the running median by
    interpolation (the app's Despike)."""
    return _sigop(data, "despike", channels, window=window, threshold=threshold)


def lowess(
    data: DataStruct,
    *,
    fraction: float = 0.3,
    iterations: int = 3,
    channels: Sequence[int] | None = None,
) -> DataStruct:
    """Robust LOWESS smoothing against X (the app's LOWESS)."""
    return _sigop(data, "lowess", channels, fraction=fraction, iterations=iterations)


def hilbert_envelope(
    data: DataStruct,
    *,
    output: str = "envelope",
    remove_mean: bool = True,
    channels: Sequence[int] | None = None,
) -> DataStruct:
    """The analytic-signal envelope (``output="envelope"``) or the Hilbert
    transform (``"hilbert"``); needs a uniform X."""
    return _sigop(data, "hilbert", channels, output=output, removeMean=remove_mean)


def resample(data: DataStruct, *, mode: str, **options: Any) -> AlignResult:
    """The app's Resample transform (``calc.resample_align.align_resample``):
    ``mode`` ``"n_points"`` / ``"step"`` / ``"range"`` / ``"match"``, with
    ``n_points``, ``step``, ``start``, ``stop``, ``match_x``, ``method``
    (``"linear"``, ``"pchip"``, ``"spline"``, ``"makima"``), ``out_of_range``
    (``"nan"``/``"clip"``) and ``unsorted`` (``"refuse"``/``"sort"``).
    Returns ``.data`` and the ``.warnings`` the app shows."""
    return align_resample(data, mode=mode, **options)
