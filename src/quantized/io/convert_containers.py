"""The container outputs of the quick converter: HDF5 / NeXus, MATLAB, JSON, NumPy.

Each writes ONE file holding every dataset (a group / struct / key prefix per
dataset) with its metadata natively. Every writer takes the target path and
``[(name, DataStruct)]`` (names already unique per file, the caller's job).

* **HDF5 / NeXus** (``.h5`` / ``.nxs``) -- the NIAC2014 plottable layout
  (https://manual.nexusformat.org/datarules.html): per dataset an ``NXentry``
  holding an ``NXdata`` group ``data`` whose ``signal`` attribute names the
  plotted field and ``axes`` its axis fields (``"."`` for none), with an
  ``<axis>_indices`` integer attribute per axis; the root ``default`` names the
  first entry, the entry ``default`` its ``data``. Every channel is a dataset
  with ``units`` and ``long_name`` attributes; the non-signal channels are also
  listed in ``auxiliary_signals`` (1-D data). A 2-D map is stored as a grid:
  ``signal`` has shape ``(n_frames, n_pixels)``; a channel constant along the
  other dimension (omega, the shared 2theta) is stored once as that dimension's
  1-D axis (recoverable by broadcast), the rest (Qx, Qz) as full grids.
  Metadata lives under ``entry/metadata`` (an ``NXcollection``): scalars and
  numeric arrays as attributes, nested mappings as sub-groups, anything else as
  a JSON string. Lists of numbers over 4096 values become datasets.
* **MATLAB** (``.mat``, ``scipy.io.savemat``, v5) -- one struct per dataset
  (a valid MATLAB name), fields ``name, time, values, labels, units, metadata``
  (+ ``grid`` for a map, ``cat_levels`` for categorical channels).
* **JSON** -- ``{"format", "version", "encoding", "datasets": [{name, time,
  values, labels, units, metadata, grid?}]}``; non-finite floats per
  ``convert_meta.JSON_ENCODING``.
* **NumPy** (``.npz``) -- per dataset ``<name>__time``, ``__values`` (float64),
  ``__labels``, ``__units`` (unicode arrays), ``__metadata`` (a 0-d string of
  JSON), ``__grid__<channel>`` for a map; plus ``__datasets__`` (the original
  names). No pickles: ``np.load`` needs no ``allow_pickle``.

The 2-D shape is kept in every container (``convert_maps.map_grid``). Pure
``io``; ``h5py`` and ``scipy`` are lazy imports (already dependencies).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct, is_categorical
from quantized.heavy_import import heavy_imports
from quantized.io.convert_maps import grid_axes, map_grid, signal_channel
from quantized.io.convert_meta import JSON_ENCODING, jsonable
from quantized.io.convert_plan import unique_name
from quantized.x_units import x_unit_of

__all__ = ["write_h5", "write_json", "write_mat", "write_npz"]

Datasets = Sequence[tuple[str, DataStruct]]
_MAX_ATTR_ARRAY = 4096


def _levels(ds: DataStruct, c: int) -> list[str] | None:
    if is_categorical(ds, c) and ds.cat_levels:
        return list(ds.cat_levels[c])
    return None


# ── HDF5 / NeXus ────────────────────────────────────────────────────────────


def _h5_name(text: str) -> str:
    cleaned = re.sub(r"[/\x00-\x1f]", "_", text).strip()
    return "_" if cleaned in ("", ".", "..") else cleaned


def _is_num_list(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) > 0
        and all(isinstance(v, (int, float, np.number)) and not isinstance(v, bool) for v in value)
    )


def _put_meta(h5py: Any, group: Any, mapping: Mapping[str, Any], depth: int = 0) -> None:
    used: set[str] = set()
    for raw_key, value in mapping.items():
        key = unique_name(_h5_name(str(raw_key)), used)
        if isinstance(value, Mapping) and depth < 6:
            _put_meta(h5py, group.create_group(key), value, depth + 1)
        elif isinstance(value, np.ndarray) and value.dtype.kind in "fiub" and value.ndim >= 1:
            _put_array(group, key, value)
        elif _is_num_list(value):
            _put_array(group, key, np.asarray(value, dtype=float))
        elif isinstance(value, (bool, np.bool_)):
            group.attrs[key] = bool(value)
        elif isinstance(value, (int, np.integer)):
            group.attrs[key] = int(value) if abs(int(value)) < 2**63 else str(value)
        elif isinstance(value, (float, np.floating)):
            group.attrs[key] = float(value)
        elif isinstance(value, str):
            group.attrs[key] = value.replace("\x00", "")
        elif value is None:
            group.attrs[key] = "null"
            group.attrs[f"{key}__json"] = True
        else:
            group.attrs[key] = json.dumps(jsonable(value), ensure_ascii=False)
            group.attrs[f"{key}__json"] = True


def _put_array(group: Any, key: str, arr: NDArray[Any]) -> None:
    if arr.size <= _MAX_ATTR_ARRAY:
        group.attrs[key] = arr
    else:
        group.create_dataset(key, data=arr, compression="gzip")


def _dataset(group: Any, name: str, data: NDArray[Any], unit: str, label: str) -> None:
    d = group.create_dataset(name, data=np.asarray(data, dtype=float))
    d.attrs["long_name"] = label
    if unit:
        d.attrs["units"] = unit


def _h5_table(group: Any, ds: DataStruct, used: set[str]) -> None:
    meta = ds.metadata
    x_label = str(meta.get("x_column_long") or meta.get("x_column_name") or "x")
    x_name = unique_name(_h5_name(x_label), used)
    _dataset(group, x_name, ds.time, x_unit_of(ds), x_label)
    sig = signal_channel(ds) if ds.n_channels else ""
    names: dict[str, str] = {}
    for c, label in enumerate(ds.labels):
        names[label] = unique_name(_h5_name(label), used)
        unit = ds.units[c] if c < len(ds.units) else ""
        _dataset(group, names[label], ds.values[:, c], unit, label)
        lv = _levels(ds, c)
        if lv:
            group[names[label]].attrs["levels"] = np.asarray(lv, dtype=object)
    if sig:
        group.attrs["signal"] = names[sig]
        rest = [names[lab] for lab in ds.labels if lab != sig]
        if rest:
            group.attrs["auxiliary_signals"] = np.asarray(rest, dtype=object)
    else:  # no channel: the x column is the only plottable field
        group.attrs["signal"] = x_name
        return
    group.attrs["axes"] = np.asarray([x_name], dtype=object)
    group.attrs[f"{x_name}_indices"] = 0


def _h5_map(
    group: Any, ds: DataStruct, grid: dict[str, NDArray[np.float64]], used: set[str]
) -> None:
    sig = signal_channel(ds)
    ax0, ax1 = grid_axes(grid, sig)
    units = dict(zip(ds.labels, ds.units, strict=False))
    axes: list[str] = []
    for dim, ax in enumerate((ax0, ax1)):
        if ax is None:
            axes.append(".")
            continue
        g = grid[ax]
        arr = g[:, 0] if dim == 0 else g[0, :]
        name = unique_name(_h5_name(ax), used)
        _dataset(group, name, arr, units.get(ax, ""), ax)
        axes.append(name)
        group.attrs[f"{name}_indices"] = dim
    names = {}
    for label, g in grid.items():
        if label in (ax0, ax1):
            continue
        names[label] = unique_name(_h5_name(label), used)
        _dataset(group, names[label], g, units.get(label, ""), label)
    group.attrs["signal"] = names[sig]
    group.attrs["axes"] = np.asarray(axes, dtype=object)
    rest = [n for lab, n in names.items() if lab != sig]
    if rest:
        group.attrs["auxiliary_signals"] = np.asarray(rest, dtype=object)
    group.attrs["quantized_map_shape"] = np.asarray(ds.metadata["map_shape"], dtype=int)
    group.attrs["quantized_axes_stored_1d"] = np.asarray([a for a in (ax0, ax1) if a], dtype=object)


def write_h5(path: Path, datasets: Datasets) -> None:
    """``datasets`` as one HDF5 / NeXus file (layout: module doc)."""
    with heavy_imports("h5py"):
        import h5py

    with h5py.File(path, "w") as f:
        f.attrs["creator"] = "quantized"
        f.attrs["NX_class"] = "NXroot"
        used_entries: set[str] = set()
        for k, (name, ds) in enumerate(datasets):
            entry = f.create_group(unique_name(_h5_name(name), used_entries))
            entry.attrs["NX_class"] = "NXentry"
            entry.attrs["default"] = "data"
            entry.attrs["dataset_name"] = name
            data = entry.create_group("data")
            data.attrs["NX_class"] = "NXdata"
            data.attrs["title"] = name
            grid = map_grid(ds)
            used: set[str] = {"metadata"}
            if grid is not None and ds.n_channels:
                _h5_map(data, ds, grid, used)
            else:
                _h5_table(data, ds, used)
            meta = entry.create_group("metadata")
            meta.attrs["NX_class"] = "NXcollection"
            _put_meta(h5py, meta, ds.metadata)
            if k == 0:
                f.attrs["default"] = entry.name.lstrip("/")


# ── MATLAB ──────────────────────────────────────────────────────────────────


def _mat_name(text: str, taken: set[str], limit: int = 63) -> str:
    cleaned = re.sub(r"\W", "_", text, flags=re.ASCII).strip("_") or "dataset"
    if not cleaned[0].isalpha():
        cleaned = f"d_{cleaned}"
    return unique_name(cleaned, taken, limit)


def _cell(items: Sequence[str]) -> NDArray[np.object_]:
    out = np.empty((len(items),), dtype=object)
    for i, s in enumerate(items):
        out[i] = s
    return out


def _mat_value(value: Any, depth: int = 0) -> Any:
    if isinstance(value, Mapping) and depth < 6:
        taken: set[str] = set()
        return {_mat_name(str(k), taken): _mat_value(v, depth + 1) for k, v in value.items()}
    if value is None:
        return np.zeros((0,))
    if isinstance(value, (bool, np.bool_)):
        return np.bool_(value)
    if isinstance(value, (int, np.integer)) and abs(int(value)) < 2**63:
        return np.int64(value)
    if isinstance(value, (float, np.floating)):
        return float(value)
    if isinstance(value, str):
        return value
    if isinstance(value, np.ndarray) and value.dtype.kind in "fiub" and value.size:
        return value
    if _is_num_list(value):
        return np.asarray(value, dtype=float)
    if isinstance(value, (list, tuple)) and value and all(isinstance(v, str) for v in value):
        return _cell(value)
    return json.dumps(jsonable(value), ensure_ascii=False)


def write_mat(path: Path, datasets: Datasets) -> None:
    """``datasets`` as one ``.mat`` (a struct per dataset; layout: module doc)."""
    with heavy_imports("scipy.io"):
        from scipy.io import savemat

    taken: set[str] = set()
    out: dict[str, Any] = {}
    for name, ds in datasets:
        grid = map_grid(ds)
        rec: dict[str, Any] = {
            "name": name,
            "time": np.asarray(ds.time, dtype=float),
            "values": np.asarray(ds.values, dtype=float),
            "labels": _cell(ds.labels),
            "units": _cell(ds.units),
            "metadata": _mat_value(dict(ds.metadata)),
        }
        if grid is not None:
            gtaken: set[str] = set()
            rec["grid"] = {_mat_name(k, gtaken): v for k, v in grid.items()}
        if ds.cat_levels:
            rec["cat_levels"] = {f"ch{k + 1}": _cell(v) for k, v in ds.cat_levels.items()}
        out[_mat_name(name, taken)] = rec
    with path.open("wb") as fh:
        savemat(fh, out, oned_as="column")


# ── JSON ────────────────────────────────────────────────────────────────────


def _json_record(name: str, ds: DataStruct) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "name": name,
        "time": jsonable(ds.time),
        "values": jsonable(ds.values),
        "labels": list(ds.labels),
        "units": list(ds.units),
        "metadata": jsonable(dict(ds.metadata)),
    }
    if ds.cat_levels:
        rec["cat_levels"] = {str(k): list(v) for k, v in ds.cat_levels.items()}
    grid = map_grid(ds)
    if grid is not None:
        rec["grid"] = {k: jsonable(v) for k, v in grid.items()}
    return rec


def write_json(path: Path, datasets: Datasets) -> None:
    """``datasets`` as one JSON file (layout: module doc), UTF-8, valid JSON."""
    doc = {
        "format": "quantized-convert",
        "version": 1,
        "encoding": {"nan": JSON_ENCODING["nan"], "inf": "Infinity", "-inf": "-Infinity"},
        "datasets": [_json_record(name, ds) for name, ds in datasets],
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, allow_nan=False), encoding="utf-8")


# ── NumPy ───────────────────────────────────────────────────────────────────


def write_npz(path: Path, datasets: Datasets) -> None:
    """``datasets`` as one compressed ``.npz`` (key layout: module doc)."""
    taken: set[str] = set()
    arrays: dict[str, NDArray[Any]] = {}
    names: list[str] = []
    for name, ds in datasets:
        key = _mat_name(name, taken)
        names.append(name)
        arrays[f"{key}__time"] = np.asarray(ds.time, dtype=float)
        arrays[f"{key}__values"] = np.asarray(ds.values, dtype=float)
        arrays[f"{key}__labels"] = np.asarray(list(ds.labels), dtype=str)
        arrays[f"{key}__units"] = np.asarray(list(ds.units), dtype=str)
        arrays[f"{key}__metadata"] = np.asarray(
            json.dumps(jsonable(dict(ds.metadata)), ensure_ascii=False)
        )
        grid = map_grid(ds)
        if grid is not None:
            seen: set[str] = set()
            for label, g in grid.items():
                arrays[f"{key}__grid__{_mat_name(label, seen)}"] = g
    arrays["__datasets__"] = np.asarray(names, dtype=str)
    with path.open("wb") as fh:
        save: Any = np.savez_compressed
        save(fh, **arrays)
