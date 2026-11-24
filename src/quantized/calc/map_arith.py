"""Map arithmetic: map (+ - x /) map, and map (+ - x /) scalar.

Origin's "Set Matrix Values" between two matrices (OriginLab, Matrix
operations: https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/Mathematics),
on the grids of ``calc/map_ops.py``.

**Grid rule (fail closed).** Two maps combine only when they sit on the SAME
grid: equal shape and every axis coordinate within 1e-6 of a pixel pitch. If
the grids differ the call is refused with both extents in the message, unless
the caller passes ``interpolate=True`` (an explicit user choice): B is then
linearly interpolated onto A's grid (``scipy.interpolate.RegularGridInterpolator``);
cells of A outside B's extent become NaN (never extrapolated). The result lives
on A's grid.

**Units.** Axis labels and units must match, and ``+``/``-`` need equal value
units; otherwise refused unless ``allow_mismatch=True``. ``x`` gives ``a*b``
and ``/`` gives ``a/b`` as the value unit. Division by zero gives NaN (counted
in the provenance), never inf. NaN cells propagate.

Scalars are dimensionless: the value unit is unchanged. ``reverse=True`` puts the
scalar on the left (``c - map``, ``c / map``).

Pure layer: no fastapi / pydantic.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import RegularGridInterpolator

from quantized.calc.map_ops import MapGrid, replace_grid

__all__ = ["OPS", "map_binary", "map_scalar"]

OPS = ("add", "sub", "mul", "div")
_SYMBOL = {"add": "+", "sub": "-", "mul": "*", "div": "/"}


def _apply(
    op: str, a: NDArray[np.float64], b: NDArray[np.float64]
) -> tuple[NDArray[np.float64], int]:
    """Elementwise ``a op b``; returns the array and the count of division-by-zero cells."""
    if op == "add":
        return np.asarray(a + b, dtype=float), 0
    if op == "sub":
        return np.asarray(a - b, dtype=float), 0
    if op == "mul":
        return np.asarray(a * b, dtype=float), 0
    if op == "div":
        zero = b == 0
        with np.errstate(divide="ignore", invalid="ignore"):
            out = np.asarray(np.where(zero, np.nan, a / np.where(zero, 1.0, b)), dtype=float)
        return out, int((zero & np.isfinite(a)).sum())
    raise ValueError(f"unknown operation {op!r}; use one of {list(OPS)}")


def _same_axis(a: NDArray[np.float64], b: NDArray[np.float64]) -> bool:
    if a.shape != b.shape:
        return False
    pitch = float(np.median(np.diff(a)))
    return bool(np.all(np.abs(a - b) <= 1e-6 * abs(pitch)))


def _extent(g: MapGrid) -> str:
    return (
        f"{g.x_label} {g.x[0]:g}..{g.x[-1]:g} ({len(g.x)}) x "
        f"{g.y_label} {g.y[0]:g}..{g.y[-1]:g} ({len(g.y)})"
    )


def _unit_of(op: str, ua: str, ub: str) -> str:
    if op in ("add", "sub"):
        return ua
    if op == "mul":
        return ua if not ub else ub if not ua else f"{ua}*{ub}"
    return ua if not ub else f"1/{ub}" if not ua else f"{ua}/{ub}"


def map_binary(
    a: MapGrid,
    b: MapGrid,
    op: str,
    *,
    interpolate: bool = False,
    allow_mismatch: bool = False,
) -> tuple[MapGrid, dict[str, Any]]:
    """``a op b`` on one grid (see the module docstring for the rules)."""
    if op not in OPS:
        raise ValueError(f"unknown operation {op!r}; use one of {list(OPS)}")
    if not allow_mismatch:
        if (a.x_unit, a.y_unit) != (b.x_unit, b.y_unit) or (
            a.x_label.lower(),
            a.y_label.lower(),
        ) != (b.x_label.lower(), b.y_label.lower()):
            raise ValueError(
                f"the axes differ: A is ({a.x_label} [{a.x_unit}], {a.y_label} [{a.y_unit}]) and "
                f"B is ({b.x_label} [{b.x_unit}], {b.y_label} [{b.y_unit}]); "
                "tick 'allow mismatched axes' only if they really are the same quantities"
            )
        if op in ("add", "sub") and a.z_unit != b.z_unit:
            raise ValueError(
                f"cannot {op} values in [{a.z_unit}] and [{b.z_unit}]; "
                "tick 'allow mismatched axes' to override"
            )
    same = _same_axis(a.x, b.x) and _same_axis(a.y, b.y)
    info: dict[str, Any] = {"op": "map_" + op, "interpolated": False}
    if same:
        zb = b.z
    elif not interpolate:
        raise ValueError(
            "the two maps are on different grids and were not combined. "
            f"A: {_extent(a)}; B: {_extent(b)}. "
            "Choose 'interpolate B onto A's grid' to resample B explicitly, or crop/regrid first"
        )
    else:
        interp = RegularGridInterpolator(
            (b.y, b.x), b.z, method="linear", bounds_error=False, fill_value=np.nan
        )
        yy, xx = np.meshgrid(a.y, a.x, indexing="ij")
        query = np.column_stack([yy.ravel(), xx.ravel()])
        zb = np.asarray(interp(query), dtype=float).reshape(a.z.shape)
        info["interpolated"] = True
        outside = (
            (yy < b.y[0]) | (yy > b.y[-1]) | (xx < b.x[0]) | (xx > b.x[-1])
        ) & ~np.isnan(a.z)
        info["cells_outside_b"] = int(outside.sum())
    z, n_zero = _apply(op, a.z, zb)
    info["division_by_zero_cells"] = n_zero
    info["expression"] = f"A {_SYMBOL[op]} B"
    return replace_grid(a, z=z, z_unit=_unit_of(op, a.z_unit, b.z_unit)), info


def map_scalar(
    a: MapGrid, op: str, value: float, *, reverse: bool = False
) -> tuple[MapGrid, dict[str, Any]]:
    """``a op value`` (or ``value op a`` with ``reverse``)."""
    if op not in OPS:
        raise ValueError(f"unknown operation {op!r}; use one of {list(OPS)}")
    if not np.isfinite(value):
        raise ValueError("the scalar must be a finite number")
    if op == "div" and not reverse and value == 0:
        raise ValueError("cannot divide a map by zero")
    s = np.full_like(a.z, float(value))
    z, n_zero = _apply(op, s, a.z) if reverse else _apply(op, a.z, s)
    expr = f"{value:g} {_SYMBOL[op]} A" if reverse else f"A {_SYMBOL[op]} {value:g}"
    info = {
        "op": "map_scalar_" + op,
        "value": float(value),
        "reverse": reverse,
        "expression": expr,
        "division_by_zero_cells": n_zero,
    }
    return replace_grid(a, z=z), info
