"""Operations on 2-D map datasets: crop, flip, rotate, transpose, plane level.

Origin's matrix tools (Crop / Flip / Rotate / Transpose / Subtract plane) and
JMP-style surface levelling, on the shared 2-D map ``DataStruct`` (a point
cloud whose rows are the cells of a regular grid; see ``io/_map_schema.py`` and
``io/_array_books.grid_map_datastruct``). References: OriginLab, "Matrix
operations" (https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/Mathematics);
plane levelling is an ordinary least-squares polynomial surface fit (Gonzalez
& Woods, *Digital Image Processing*, the usual AFM "plane fit" background).

**Reading a map.** :func:`read_grid` picks the X, Y and Z columns (default: the
two axis columns and ``Intensity`` of a 3-column map, or the RSM angular pair)
and re-detects the regular grid with ``_grid_detect.detect_regular_grid``. A
scattered cloud that is not on a grid (an RSM in Q space) is REFUSED with a
message pointing at the angular axes or a regrid: the operations never
interpolate behind the user's back. Axes always come out ascending.

**Conventions (provisional, owner to confirm).**

* The picture is drawn with Y up, X right, ``z[j, i]`` at ``(x[i], y[j])``.
* ``flip_h`` / ``flip_v`` mirror the data inside the map's extent; the axis
  coordinates are unchanged (Origin's matrix flip).
* ``rotate`` turns the picture counter-clockwise by 90/180/270 degrees. A
  quarter turn swaps the axes: the new X axis is the old Y axis with its label
  and unit, and vice versa (its coordinates stay ascending and keep their
  extent; the data is re-arranged under them). ``transpose`` is the mirror in
  the diagonal: ``z.T`` with the axes swapped.
* ``crop`` keeps the cells whose coordinates lie inside the inclusive
  rectangle (a tolerance of 1e-9 of the axis span); at least two cells must
  remain along each axis.
* ``plane_level`` fits ``z = sum c_pq u^p v^q (p + q <= order)`` by least
  squares on the finite cells (u, v are the axes scaled to [-1, 1]) and
  subtracts it. Order 1 is a plane, order 2 a quadric. Rank-deficient or
  under-determined fits are refused.

Output is a native-grid map DataStruct (``map_grid = "native"``) carrying a
``map_op`` provenance dict. Only the three chosen columns are kept (an RSM's
other coordinate columns do not survive a crop or rotate). Pure layer: no
fastapi / pydantic.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc._grid_detect import detect_regular_grid, grid_to_zarray
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

__all__ = [
    "MapGrid",
    "crop",
    "flip",
    "grid_result",
    "plane_level",
    "read_grid",
    "replace_grid",
    "rotate",
    "transpose",
]

_DROP_META = ("is2D", "map_shape", "map_grid", "axis1_name", "axis2_name", "x_channel", "map_op")


@dataclass(frozen=True)
class MapGrid:
    """A map as a dense ``(ny, nx)`` array with ascending axes and their names."""

    x: NDArray[np.float64]
    y: NDArray[np.float64]
    z: NDArray[np.float64]
    x_label: str
    x_unit: str
    y_label: str
    y_unit: str
    z_unit: str
    metadata: Mapping[str, Any]


def _col_index(ds: DataStruct, key: int | str | None) -> int | None:
    if key is None:
        return None
    if isinstance(key, str):
        if key not in ds.labels:
            raise ValueError(f"no column named {key!r}; columns are {list(ds.labels)}")
        return ds.labels.index(key)
    if not 0 <= key < len(ds.labels):
        raise ValueError(f"column {key} is out of range (0..{len(ds.labels) - 1})")
    return int(key)


def _default_columns(ds: DataStruct) -> tuple[int, int, int]:
    labels = list(ds.labels)
    z = labels.index("Intensity") if "Intensity" in labels else len(labels) - 1
    others = [i for i in range(len(labels)) if i != z]
    if len(others) == 2:
        return others[0], others[1], z
    primary = "2Theta" if "2Theta" in labels else None
    secondary = ds.metadata.get("axis1_name")
    if primary and isinstance(secondary, str) and secondary in labels:
        return labels.index(primary), labels.index(secondary), z
    raise ValueError(
        "this map has more than two coordinate columns "
        f"({[labels[i] for i in others]}); choose the X, Y and Z columns explicitly"
    )


def read_grid(
    ds: DataStruct,
    x_col: int | str | None = None,
    y_col: int | str | None = None,
    z_col: int | str | None = None,
) -> MapGrid:
    """The regular grid under a map DataStruct, or ``ValueError`` saying why not."""
    if ds.values.ndim != 2 or ds.values.shape[1] < 3:
        raise ValueError("a map needs at least three columns (X, Y and a value)")
    dx, dy, dz = _default_columns(ds) if None in (x_col, y_col, z_col) else (0, 0, 0)
    xi = _col_index(ds, x_col)
    yi = _col_index(ds, y_col)
    zi = _col_index(ds, z_col)
    xi, yi, zi = (dx if xi is None else xi), (dy if yi is None else yi), (dz if zi is None else zi)
    if len({xi, yi, zi}) != 3:
        raise ValueError("the X, Y and Z columns must be three different columns")
    x = np.asarray(ds.values[:, xi], dtype=float)
    y = np.asarray(ds.values[:, yi], dtype=float)
    z = np.asarray(ds.values[:, zi], dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    layout = detect_regular_grid(x[ok], y[ok])
    if layout is None or layout.nx < 2 or layout.ny < 2:
        raise ValueError(
            f"the ({ds.labels[xi]}, {ds.labels[yi]}) points do not form a regular grid, so "
            "map operations cannot run on them. Choose axes the map was measured on "
            "(for an RSM, the angular pair rather than Q space) or regrid it first"
        )
    grid = grid_to_zarray(layout, z[ok])
    units = list(ds.units) + [""] * (len(ds.labels) - len(ds.units))
    return MapGrid(
        x=np.asarray(layout.ux, dtype=float),
        y=np.asarray(layout.uy, dtype=float),
        z=grid,
        x_label=ds.labels[xi],
        x_unit=units[xi],
        y_label=ds.labels[yi],
        y_unit=units[yi],
        z_unit=units[zi],
        metadata=dict(ds.metadata),
    )


def grid_result(g: MapGrid, op: dict[str, Any]) -> DataStruct:
    """A native-grid map DataStruct from ``g`` with the ``map_op`` provenance."""
    meta = {k: v for k, v in g.metadata.items() if k not in _DROP_META}
    meta["map_op"] = op
    return grid_map_datastruct(
        g.z,
        g.x,
        g.y,
        x_label=g.x_label,
        x_unit=g.x_unit,
        y_label=g.y_label,
        y_unit=g.y_unit,
        z_unit=g.z_unit,
        metadata=meta,
    )


def replace_grid(g: MapGrid, **kw: Any) -> MapGrid:
    """``g`` with some fields replaced."""
    return MapGrid(**{**g.__dict__, **kw})


def _select(axis: NDArray[np.float64], lo: float | None, hi: float | None, name: str) -> Any:
    tol = 1e-9 * float(np.ptp(axis))
    lo_v = -np.inf if lo is None else lo
    hi_v = np.inf if hi is None else hi
    if np.isnan(lo_v) or np.isnan(hi_v):
        raise ValueError(f"{name} crop bounds must be numbers")
    if lo_v > hi_v:
        raise ValueError(f"{name} crop: minimum {lo} is greater than maximum {hi}")
    keep = (axis >= lo_v - tol) & (axis <= hi_v + tol)
    if int(keep.sum()) < 2:
        raise ValueError(
            f"{name} crop [{lo}, {hi}] keeps {int(keep.sum())} point(s) of the "
            f"{axis[0]:g}..{axis[-1]:g} axis; at least 2 are needed"
        )
    return keep


def crop(
    g: MapGrid,
    *,
    xmin: float | None = None,
    xmax: float | None = None,
    ymin: float | None = None,
    ymax: float | None = None,
) -> tuple[MapGrid, dict[str, Any]]:
    """Keep the cells inside the inclusive rectangle (None = unbounded)."""
    kx = _select(g.x, xmin, xmax, g.x_label)
    ky = _select(g.y, ymin, ymax, g.y_label)
    out = replace_grid(g, x=g.x[kx], y=g.y[ky], z=g.z[np.ix_(ky, kx)])
    return out, {"op": "crop", "xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax}


def flip(g: MapGrid, axis: str) -> tuple[MapGrid, dict[str, Any]]:
    """Mirror the data left-right (``"h"``) or top-bottom (``"v"``), axes unchanged."""
    if axis not in ("h", "v"):
        raise ValueError(f"flip axis must be 'h' or 'v', got {axis!r}")
    z = g.z[:, ::-1] if axis == "h" else g.z[::-1, :]
    return replace_grid(g, z=np.ascontiguousarray(z)), {"op": "flip", "axis": axis}


def _swapped(g: MapGrid, z: NDArray[np.float64]) -> MapGrid:
    return replace_grid(
        g,
        x=g.y,
        y=g.x,
        z=np.ascontiguousarray(z),
        x_label=g.y_label,
        x_unit=g.y_unit,
        y_label=g.x_label,
        y_unit=g.x_unit,
    )


def transpose(g: MapGrid) -> tuple[MapGrid, dict[str, Any]]:
    """Mirror in the diagonal: ``z.T`` with the X and Y axes (labels, units) swapped."""
    return _swapped(g, g.z.T), {"op": "transpose"}


def rotate(g: MapGrid, degrees: int) -> tuple[MapGrid, dict[str, Any]]:
    """Turn the picture counter-clockwise (Y up) by 90, 180 or 270 degrees."""
    if degrees not in (90, 180, 270):
        raise ValueError(f"rotation must be 90, 180 or 270 degrees, got {degrees!r}")
    if degrees == 180:
        out = replace_grid(g, z=np.ascontiguousarray(g.z[::-1, ::-1]))
    elif degrees == 90:
        out = _swapped(g, g.z.T[:, ::-1])
    else:
        out = _swapped(g, g.z.T[::-1, :])
    return out, {"op": "rotate", "degrees": degrees}


def _design(u: NDArray[np.float64], v: NDArray[np.float64], order: int) -> NDArray[np.float64]:
    cols = [u**p * v**q for p in range(order + 1) for q in range(order + 1 - p)]
    return np.column_stack(cols)


def plane_level(
    g: MapGrid, order: int = 1, *, restore_mean: bool = False
) -> tuple[MapGrid, dict[str, Any]]:
    """Subtract a least-squares polynomial surface (order 1 plane, 2 quadric).

    ``restore_mean`` adds the fitted surface's mean back, so the map keeps its
    average level and only the tilt/curvature is removed.
    """
    if order not in (1, 2):
        raise ValueError(f"plane level order must be 1 or 2, got {order!r}")
    xx, yy = np.meshgrid(g.x, g.y)
    hx = float(np.ptp(g.x)) / 2.0
    hy = float(np.ptp(g.y)) / 2.0
    u = (xx - (g.x[0] + g.x[-1]) / 2.0) / hx
    v = (yy - (g.y[0] + g.y[-1]) / 2.0) / hy
    finite = np.isfinite(g.z)
    a = _design(u[finite], v[finite], order)
    n_terms = a.shape[1]
    if a.shape[0] < n_terms + 1:
        raise ValueError(
            f"only {a.shape[0]} finite cells: too few for an order-{order} surface "
            f"({n_terms} coefficients)"
        )
    coef, _res, rank, _sv = np.linalg.lstsq(a, g.z[finite], rcond=None)
    if rank < n_terms:
        raise ValueError(
            f"the order-{order} surface fit is rank deficient (rank {rank} of {n_terms})"
        )
    full = _design(u.ravel(), v.ravel(), order) @ coef
    surface = np.asarray(full.reshape(g.z.shape), dtype=float)
    shift = float(np.mean(surface[finite])) if restore_mean else 0.0
    out_z = np.asarray(g.z - surface + shift, dtype=float)
    rms = float(np.sqrt(np.mean((g.z[finite] - surface[finite]) ** 2)))
    info: dict[str, Any] = {
        "op": "plane_level",
        "order": order,
        "restore_mean": restore_mean,
        # Coefficients of u^p v^q in design order (1, v, [v^2], u, [u v], [u^2]); u, v in [-1, 1].
        "coefficients_scaled": [float(c) for c in coef],
        "rms_residual": rms,
        "n_cells_fitted": int(finite.sum()),
    }
    if order == 1:
        # design order is (1, v, u): physical slopes of z per unit X and per unit Y.
        info["tilt"] = {
            f"d{g.x_label}": float(coef[2]) / hx,
            f"d{g.y_label}": float(coef[1]) / hy,
        }
    return replace_grid(g, z=out_z), info
