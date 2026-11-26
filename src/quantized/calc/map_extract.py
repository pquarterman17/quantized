"""Pixel extraction across maps: the value at one (x, y) in every map.

Given a location and a selection of maps (a map series, typically a drift or
a temperature/field sweep), return a worksheet with ONE ROW PER MAP, in the
order given: the map's number (the row's X), its name (a categorical column),
the value at the location and the nearest cell it came from.

**Interpolation: bilinear between the four surrounding cells** of each map's
own regular grid (``read_grid``: the map must be on a regular grid, as for
every map operation). A location exactly on a cell is that cell's value. It
is NOT extrapolated: a location outside a map's extent, or a cell among the
four that is blank (NaN), gives a blank (NaN) value for that map, with the
reason recorded in ``metadata["extract"]["notes"]``, never a guess. A
location outside EVERY map is refused (``ValueError``).

Columns: ``Value`` (bilinear), ``Nearest value`` (the single nearest cell, so
a bilinear blur of a sharp feature is checkable), ``Cell X`` / ``Cell Y`` (that
cell's coordinates). Pure layer; the maps are never modified.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from quantized.calc.map_ops import MapGrid
from quantized.datastruct import DataStruct

__all__ = ["bilinear_at", "extract_pixel"]


def bilinear_at(g: MapGrid, x: float, y: float) -> tuple[float, float, float, float, str]:
    """``(bilinear, nearest value, cell x, cell y, note)`` at ``(x, y)``.

    ``bilinear`` is NaN with a non-empty ``note`` when the point is outside
    the map or touches a blank cell; the nearest-cell fields still report the
    closest cell when the point is inside the extent."""
    nan = float("nan")
    if not (g.x[0] <= x <= g.x[-1] and g.y[0] <= y <= g.y[-1]):
        return nan, nan, nan, nan, "outside the map"
    i = int(np.clip(np.searchsorted(g.x, x, side="right") - 1, 0, g.x.size - 2))
    j = int(np.clip(np.searchsorted(g.y, y, side="right") - 1, 0, g.y.size - 2))
    tx = (x - g.x[i]) / (g.x[i + 1] - g.x[i])
    ty = (y - g.y[j]) / (g.y[j + 1] - g.y[j])
    ni = i + (1 if tx > 0.5 else 0)
    nj = j + (1 if ty > 0.5 else 0)
    near = float(g.z[nj, ni])
    corners = g.z[j : j + 2, i : i + 2]
    # A corner with zero weight (the point sits on a grid line) cannot block it.
    weights = np.array([[(1 - ty) * (1 - tx), (1 - ty) * tx], [ty * (1 - tx), ty * tx]])
    live = weights > 0
    if not bool(np.isfinite(corners[live]).all()):
        return nan, near, float(g.x[ni]), float(g.y[nj]), "a surrounding cell is blank"
    value = float(np.sum(weights[live] * corners[live]))
    return value, near, float(g.x[ni]), float(g.y[nj]), ""


def extract_pixel(
    maps: Sequence[tuple[str, MapGrid]], x: float, y: float
) -> DataStruct:
    """One row per map: the value at ``(x, y)`` (see the module docstring)."""
    if not maps:
        raise ValueError("choose at least one map")
    if not (np.isfinite(x) and np.isfinite(y)):
        raise ValueError("the location must be two finite numbers")
    rows: list[list[float]] = []
    notes: list[str] = []
    names: list[str] = []
    seen: dict[str, int] = {}
    for name, g in maps:
        if g.x.size < 2 or g.y.size < 2:
            raise ValueError(f"map {name!r} has fewer than 2 cells along an axis")
        v, near, cx, cy, note = bilinear_at(g, x, y)
        rows.append([v, near, cx, cy])
        notes.append(note)
        seen[name] = seen.get(name, 0) + 1
        names.append(name if seen[name] == 1 else f"{name} ({seen[name]})")
    vals = np.asarray(rows, dtype=float)
    if not bool(np.isfinite(vals[:, 0]).any()):
        raise ValueError(
            f"({x:g}, {y:g}) gives no value in any map: "
            + "; ".join(sorted({n for n in notes if n}))
        )
    first = maps[0][1]
    table = np.column_stack([np.arange(len(maps), dtype=float), vals])
    meta: dict[str, Any] = {
        "extract": {
            "x": x,
            "y": y,
            "interpolation": "bilinear",
            "maps": names,
            "notes": [{"map": n, "note": t} for n, t in zip(names, notes, strict=True) if t],
        }
    }
    return DataStruct.create(
        np.arange(1, len(maps) + 1, dtype=float),
        table,
        labels=["Map", "Value", "Nearest value", f"Cell {first.x_label}", f"Cell {first.y_label}"],
        units=["", first.z_unit, first.z_unit, first.x_unit, first.y_unit],
        metadata=meta,
        cat_levels={0: tuple(names)},
    )
