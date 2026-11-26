"""Read a map DataStruct as scattered points, and as a grid when it is one.

Shared by ``map_peaks`` (peak finding / fitting on any map) and ``map_volume``
(ROI volume integration). A map is the shared 2-D DataStruct of
``io/_map_schema.py``: one row per cell or detector pixel, the axes and the
value as columns. A regular grid (an image, a contour matrix, an angular RSM)
is detected with ``_grid_detect``; anything else (an RSM in Q space, a
scattered survey) stays a point cloud. Nothing here interpolates.

Pure layer: ndarray / DataStruct in, dataclass out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc._grid_detect import detect_regular_grid, grid_to_zarray
from quantized.datastruct import DataStruct

__all__ = ["MapPoints", "read_points"]


@dataclass(frozen=True)
class MapPoints:
    """The finite ``(x, y, z)`` points of a map plus its grid, when it has one.

    ``z`` may hold NaN (a cell with no value). ``grid`` is ``(ny, nx)`` with
    ascending axes ``ux`` / ``uy`` (NaN where a cell is missing), or ``None``
    for a point cloud.
    """

    x: NDArray[np.float64]
    y: NDArray[np.float64]
    z: NDArray[np.float64]
    x_label: str
    x_unit: str
    y_label: str
    y_unit: str
    z_label: str
    z_unit: str
    ux: NDArray[np.float64] | None = None
    uy: NDArray[np.float64] | None = None
    grid: NDArray[np.float64] | None = None

    @property
    def gridded(self) -> bool:
        return self.grid is not None


def _index(ds: DataStruct, key: int | str | None, default: int) -> int:
    if key is None:
        return default
    if isinstance(key, str):
        if key not in ds.labels:
            raise ValueError(f"no column named {key!r}; columns are {list(ds.labels)}")
        return ds.labels.index(key)
    if not 0 <= key < len(ds.labels):
        raise ValueError(f"column {key} is out of range (0..{len(ds.labels) - 1})")
    return int(key)


def _defaults(ds: DataStruct) -> tuple[int, int, int]:
    labels = list(ds.labels)
    z = labels.index("Intensity") if "Intensity" in labels else len(labels) - 1
    others = [i for i in range(len(labels)) if i != z]
    if len(others) == 2:
        return others[0], others[1], z
    secondary = ds.metadata.get("axis1_name")
    if "2Theta" in labels and isinstance(secondary, str) and secondary in labels:
        return labels.index("2Theta"), labels.index(secondary), z
    raise ValueError(
        "this map has more than two coordinate columns "
        f"({[labels[i] for i in others]}); choose the X, Y and value columns explicitly"
    )


def read_points(
    ds: DataStruct,
    x_col: int | str | None = None,
    y_col: int | str | None = None,
    z_col: int | str | None = None,
) -> MapPoints:
    """The map's finite-coordinate points; ``ValueError`` when it is not a map."""
    if ds.values.ndim != 2 or ds.values.shape[1] < 3:
        raise ValueError("a map needs at least three columns (X, Y and a value)")
    dx, dy, dz = _defaults(ds) if None in (x_col, y_col, z_col) else (0, 0, 0)
    xi, yi, zi = _index(ds, x_col, dx), _index(ds, y_col, dy), _index(ds, z_col, dz)
    if len({xi, yi, zi}) != 3:
        raise ValueError("the X, Y and value columns must be three different columns")
    x = np.asarray(ds.values[:, xi], dtype=float)
    y = np.asarray(ds.values[:, yi], dtype=float)
    z = np.asarray(ds.values[:, zi], dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    if int(ok.sum()) < 4:
        raise ValueError("the map has fewer than 4 points with finite coordinates")
    x, y, z = x[ok], y[ok], z[ok]
    units = list(ds.units) + [""] * (len(ds.labels) - len(ds.units))
    layout = detect_regular_grid(x, y)
    common: dict[str, Any] = {
        "x_label": ds.labels[xi],
        "x_unit": units[xi],
        "y_label": ds.labels[yi],
        "y_unit": units[yi],
        "z_label": ds.labels[zi],
        "z_unit": units[zi],
    }
    if layout is None or layout.nx < 2 or layout.ny < 2:
        return MapPoints(x, y, z, **common)
    return MapPoints(
        x,
        y,
        z,
        ux=np.asarray(layout.ux, dtype=float),
        uy=np.asarray(layout.uy, dtype=float),
        grid=grid_to_zarray(layout, z),
        **common,
    )
