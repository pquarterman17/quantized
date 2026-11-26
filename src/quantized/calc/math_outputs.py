"""DataStructs for the math extras' derived datasets.

Each result is a NEW worksheet whose metadata names the operation and its
settings under ``math_extras`` (the caller's commit adds the source, producer and
freshness provenance). Pure layer.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike

from quantized.calc.map_correlate import CorrelationPeak
from quantized.calc.map_ops import MapGrid
from quantized.calc.math_interp import BSplineResult, ScatterResult, TraceResult
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

__all__ = ["bspline_datastruct", "correlation_datastruct", "scatter_datastruct", "trace_datastruct"]


def trace_datastruct(
    r: TraceResult,
    *,
    x_label: str,
    x_unit: str,
    y_label: str,
    y_unit: str,
    settings: dict[str, Any],
) -> DataStruct:
    """Resampled path: X as the axis, Y and the arc length as columns."""
    return DataStruct.create(
        r.x,
        np.column_stack([r.y, r.s]),
        labels=[y_label, "Arc length"],
        units=[y_unit, x_unit if x_unit == y_unit else ""],
        metadata={
            "x_column_name": x_label,
            "x_column_unit": x_unit,
            "math_extras": {"kind": "trace", "total_length": r.total_length, **settings},
        },
    )


def bspline_datastruct(
    r: BSplineResult,
    *,
    x_label: str,
    x_unit: str,
    y_label: str,
    y_unit: str,
    settings: dict[str, Any],
) -> DataStruct:
    """Resampled spline: X grid as the axis, the spline value as the column."""
    return DataStruct.create(
        r.x,
        r.y.reshape(-1, 1),
        labels=[y_label],
        units=[y_unit],
        metadata={
            "x_column_name": x_label,
            "x_column_unit": x_unit,
            "math_extras": {
                "kind": "bspline",
                "degree": r.degree,
                "smoothing": r.smoothing,
                "residual": r.residual,
                "n_knots": r.n_knots,
                **settings,
            },
        },
    )


def scatter_datastruct(
    r: ScatterResult,
    queries: ArrayLike,
    *,
    coord_labels: list[str],
    coord_units: list[str],
    value_label: str,
    value_unit: str,
    settings: dict[str, Any],
) -> DataStruct:
    """The chosen points with the interpolated value; the first coordinate is the axis."""
    q = np.asarray(queries, dtype=float)
    return DataStruct.create(
        q[:, 0],
        np.column_stack([q[:, 1:], r.w]),
        labels=[*coord_labels[1:], value_label],
        units=[*coord_units[1:], value_unit],
        metadata={
            "x_column_name": coord_labels[0],
            "x_column_unit": coord_units[0],
            "math_extras": {
                "kind": "scatter",
                "method": r.method,
                "outside": r.outside,
                "merged": r.merged,
                "n_points": r.n_points,
                **settings,
            },
        },
    )


def correlation_datastruct(g: MapGrid, p: CorrelationPeak, settings: dict[str, Any]) -> DataStruct:
    """The correlation map, with the peak and its offsets in the metadata."""
    peak = {
        "value": p.value,
        "offset_x": p.offset_x,
        "offset_y": p.offset_y,
        "lag_x": p.lag_x,
        "lag_y": p.lag_y,
        "subpixel": p.subpixel,
        "blank_cells": p.blank_cells,
    }
    return grid_map_datastruct(
        g.z,
        g.x,
        g.y,
        x_label=g.x_label,
        x_unit=g.x_unit,
        y_label=g.y_label,
        y_unit=g.y_unit,
        z_unit="",
        metadata={**g.metadata, "math_extras": {"kind": "correlate", "peak": peak, **settings}},
    )
