"""Shared DataStruct builders for the array-container importers.

HDF5 / NeXus (``hdf5_read``), MATLAB ``.mat`` (``matlab_mat``), Igor binary
waves (``igor_ibw``) and images (``image_import``) all end the same way: a few
numeric arrays that must become a *table* (columns against an x axis) or a
*map* (a 2-D grid over two axes). These two builders are that one ending, so
every importer produces the same DataStruct shapes the rest of the app already
reads (``io/_map_schema.py`` for the map).

Pure layer: ndarray in -> DataStruct out. No fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io._map_schema import map_datastruct

__all__ = [
    "MAX_BOOKS",
    "MAX_COLUMNS",
    "MAX_MAP_POINTS",
    "grid_map_datastruct",
    "index_map_datastruct",
    "table_datastruct",
]

#: Datasets/books offered from one container file (Excel's ``MAX_SHEETS``, too).
MAX_BOOKS = 64
#: Columns of one table. A wider 2-D array is an image or a matrix, not a table.
MAX_COLUMNS = 256
#: Pixels/cells of one map. Every cell is a DataStruct row of three float64s and
#: a JSON row on the wire, so a 2048 x 2048 grid is the practical ceiling.
MAX_MAP_POINTS = 2048 * 2048


def table_datastruct(
    columns: Sequence[tuple[str, NDArray[Any], str]],
    *,
    x: NDArray[Any] | None = None,
    x_name: str = "index",
    x_unit: str = "",
    metadata: Mapping[str, Any] | None = None,
) -> DataStruct:
    """``(label, 1-D array, unit)`` columns against ``x``.

    ``x=None`` is the row index (0, 1, 2, ...): no column is guessed to be the
    axis, the user picks one afterwards. Every column must have the same
    length (the callers group by length first)."""
    if not columns:
        raise ValueError("no columns to import")
    n = int(np.asarray(columns[0][1]).shape[0])
    values = np.column_stack([np.asarray(c, dtype=float).reshape(n) for _, c, _ in columns])
    axis = np.arange(n, dtype=float) if x is None else np.asarray(x, dtype=float).reshape(n)
    meta = {**(metadata or {}), "x_column_name": x_name, "x_column_unit": x_unit}
    return DataStruct.create(
        axis,
        values,
        labels=[name for name, _, _ in columns],
        units=[unit for _, _, unit in columns],
        metadata=meta,
    )


def grid_map_datastruct(
    z: NDArray[Any],
    x_axis: NDArray[Any],
    y_axis: NDArray[Any],
    *,
    x_label: str,
    x_unit: str,
    y_label: str,
    y_unit: str,
    z_unit: str = "",
    metadata: Mapping[str, Any] | None = None,
) -> DataStruct:
    """A ``(ny, nx)`` grid as the shared 2-D map DataStruct.

    ``z[j, i]`` sits at ``(x_axis[i], y_axis[j])``; rows run y-outer, x-inner,
    so ``map_shape`` is ``[ny, nx]``. Stamps ``map_grid = "native"``: the grid is
    the data, so the map path returns it as stored instead of interpolating."""
    zz = np.asarray(z, dtype=float)
    if zz.ndim != 2 or zz.shape != (len(y_axis), len(x_axis)):
        raise ValueError(
            f"grid shape {zz.shape} does not match its axes ({len(y_axis)} y x {len(x_axis)} x)"
        )
    if zz.size > MAX_MAP_POINTS:
        raise ValueError(
            f"a {zz.shape[1]} x {zz.shape[0]} grid has {zz.size:,} points; "
            f"the limit is {MAX_MAP_POINTS:,}. Crop or downsample it first"
        )
    xs, ys = np.meshgrid(
        np.asarray(x_axis, dtype=float), np.asarray(y_axis, dtype=float), indexing="xy"
    )
    values = np.column_stack([xs.ravel(), ys.ravel(), zz.ravel()])
    meta = {
        **(metadata or {}),
        "is2D": True,
        "map_shape": [int(zz.shape[0]), int(zz.shape[1])],
        # The rows ARE the grid: the Map tab shows it cell for cell, not
        # regridded to 200 x 200 (calc/map.py ``_native_map``).
        "map_grid": "native",
        "x_column_name": x_label,
        "x_column_unit": x_unit,
    }
    return map_datastruct(
        values,
        [x_label, y_label, "Intensity"],
        [x_unit, y_unit, z_unit],
        meta,
        x_channel=x_label,
    )


def index_map_datastruct(
    z: NDArray[Any], *, metadata: Mapping[str, Any] | None = None
) -> DataStruct:
    """A bare 2-D array (no axes of its own) as a map over its indices: ``X`` is
    the column index, ``Y`` the row index (row 0 first, as the array is
    indexed). Used for a matrix too wide to be a table of columns."""
    zz = np.asarray(z, dtype=float)
    if zz.ndim != 2:
        raise ValueError(f"expected a 2-D array, got {zz.ndim}-D")
    meta = {**(metadata or {}), "axes": "indices"}
    return grid_map_datastruct(
        zz,
        np.arange(zz.shape[1], dtype=float),
        np.arange(zz.shape[0], dtype=float),
        x_label="column",
        x_unit="",
        y_label="row",
        y_unit="",
        metadata=meta,
    )
