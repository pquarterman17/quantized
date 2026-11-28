"""The NetCDF output of the quick converter (NetCDF-3 64-bit offset, no new dependency).

``scipy.io.netcdf_file`` writes the file; any NetCDF library (and
``io/netcdf.py``) reads it back. NetCDF-3 has no groups, so every name carries
its dataset's prefix ``<p>`` (a valid NetCDF name made from the dataset name,
``~2`` for a repeat):

* global attributes ``format = "quantized-convert"``, ``version = 1``,
  ``datasets`` (JSON ``[{"name", "prefix"}]``, the original names) and, per
  dataset, ``<p>_metadata`` (JSON, ``convert_meta.jsonable``, private keys
  left out; ``NaN`` is ``null``);
* dimension ``<p>_point`` and, per dataset, ``<p>_x`` (the independent column)
  and one float64 variable per channel, ``<p>_<label>`` (``~2`` for a repeat),
  each with ``long_name`` (the exact label) and ``units``; a categorical
  channel holds its level codes and a ``levels`` attribute (JSON list);
* a 2-D map also keeps its shape: dimensions ``<p>_frame`` and ``<p>_pixel``
  and a variable ``<p>_grid_<label>(frame, pixel)`` per channel
  (``convert_maps.map_grid``), beside the rows.

Text attributes are UTF-8 bytes. A dataset with no rows is refused (NetCDF-3
reads a zero-length dimension as unlimited). Pure ``io``; ``scipy.io`` is a
lazy import.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct, is_categorical
from quantized.heavy_import import heavy_imports
from quantized.io.convert_maps import map_grid
from quantized.io.convert_meta import jsonable, public_metadata, x_label
from quantized.io.convert_plan import unique_name
from quantized.x_units import x_unit_of

__all__ = ["write_netcdf"]

_NAME_MAX = 40


def _ident(text: str, fallback: str) -> str:
    """``text`` as a NetCDF-safe name (ASCII word characters, a letter first)."""
    cleaned = re.sub(r"\W", "_", text, flags=re.ASCII).strip("_") or fallback
    return cleaned if cleaned[0].isalpha() else f"{fallback}_{cleaned}"


def _text(value: str) -> bytes:
    return value.encode("utf-8", "replace")


def _put(nc: Any, name: str, dims: tuple[str, ...], data: Any, label: str, unit: str) -> Any:
    var = nc.createVariable(name, "f8", dims)
    var[:] = np.asarray(data, dtype=float)
    var.long_name = _text(label)
    var.units = _text(unit)
    return var


def write_netcdf(path: Path, datasets: Sequence[tuple[str, DataStruct]]) -> None:
    """``datasets`` as one NetCDF-3 file (layout: module doc)."""
    for name, ds in datasets:
        if ds.n_points < 1:
            raise ValueError(f"dataset {name!r} has no rows; NetCDF cannot hold an empty dimension")
    with heavy_imports("scipy.io"):
        from scipy.io import netcdf_file

    prefixes: set[str] = set()
    index: list[dict[str, str]] = []
    nc = netcdf_file(str(path), "w", version=2)
    try:
        nc.format = b"quantized-convert"
        nc.version = np.int32(1)
        for name, ds in datasets:
            p = unique_name(_ident(name, "dataset"), prefixes, _NAME_MAX)
            index.append({"name": name, "prefix": p})
            _write_one(nc, p, ds)
        nc.datasets = _text(json.dumps(index, ensure_ascii=False))
    finally:
        nc.close()


def _write_one(nc: Any, p: str, ds: DataStruct) -> None:
    point = f"{p}_point"
    nc.createDimension(point, int(ds.n_points))
    setattr(nc, f"{p}_metadata", _text(
        json.dumps(jsonable(public_metadata(ds.metadata)), ensure_ascii=False)
    ))
    _put(nc, f"{p}_x", (point,), ds.time, x_label(ds), x_unit_of(ds))
    taken = {"x"}
    names: list[str] = []
    for c, label in enumerate(ds.labels):
        col = unique_name(_ident(label, f"ch{c + 1}"), taken)
        names.append(col)
        unit = ds.units[c] if c < len(ds.units) else ""
        var = _put(nc, f"{p}_{col}", (point,), ds.values[:, c], label, unit)
        if is_categorical(ds, c) and ds.cat_levels:
            var.levels = _text(json.dumps(list(ds.cat_levels[c]), ensure_ascii=False))
    grid = map_grid(ds)
    if grid is not None:
        nf, npx = next(iter(grid.values())).shape
        nc.createDimension(f"{p}_frame", nf)
        nc.createDimension(f"{p}_pixel", npx)
        for col, (label, g) in zip(names, grid.items(), strict=True):
            _put(nc, f"{p}_grid_{col}", (f"{p}_frame", f"{p}_pixel"), g, label, "")
