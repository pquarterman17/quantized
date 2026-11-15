"""HDF5 / NeXus import (``.h5``, ``.hdf5``, ``.nxs``).

Three kinds of file, tried in this order:

1. **Quantized's own export** (``io/hdf5.py``: root attribute
   ``toolboxName == "quantized"`` and a ``/raw`` group). Read back exactly:
   ``time``, ``values``, ``labels``, ``units`` (the padded-ASCII matrices, and
   the exact UTF-8 ``utf8`` attribute when a unit had non-ASCII characters),
   the x-axis name and unit, and categorical level tables. ``/corrected`` is a
   second book; ``/corrections`` ride in ``metadata.hdf5_corrections``. MATLAB's
   ``exportHDF5`` writes the same schema with every array's shape reversed
   (column-major), which is detected and undone.
2. **NeXus** ``NXdata`` groups: axes from ``@signal`` / ``@axes``.
3. **Any other HDF5**: each group's 1-D / 2-D numeric datasets.

(2) and (3) are described in ``io/_hdf5_nexus.py``. Anything that would need a
guess is refused with its reason and listed in the first book's
``metadata.notes``; a file with nothing importable raises ``ValueError`` naming
why. The file is opened read-only, hard links only, with the bounds in
``io/_hdf5_walk.py``.

``read_hdf5_books`` returns every book (the registry's multi-dataset path);
``import_hdf5`` is the first. Pure layer; ``h5py`` is imported lazily.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io._array_books import MAX_BOOKS
from quantized.io._hdf5_nexus import generic_books, nxdata_book
from quantized.io._hdf5_walk import (
    Budget,
    attr_str,
    h5py_module,
    is_hdf5,
    open_hdf5,
    read_numeric,
    same_file_child,
    walk_groups,
)

__all__ = ["import_hdf5", "is_hdf5", "read_hdf5_books"]


def _text(value: Any) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


def _decode_strings(
    group: Any, name: str, expected: int, budget: Budget, *, transposed: bool
) -> list[str]:
    """A padded-ASCII string dataset (one string per row), preferring the exact
    ``utf8`` attribute the exporter adds when a string is not ASCII."""
    dset = same_file_child(group, name, budget)
    exact = dset.attrs.get("utf8")
    if exact is not None:
        out = [_text(v) for v in np.asarray(exact).reshape(-1)]
        if len(out) == expected:
            return out
    mat = np.asarray(read_numeric(f"{group.name}/{name}", dset, budget), dtype=np.uint8)
    if mat.ndim == 1:
        mat = mat.reshape(1, -1)
    if transposed:
        mat = mat.T  # MATLAB writes the matrix column-major
    if mat.shape[0] != expected:
        raise ValueError(f"{group.name}/{name} holds {mat.shape[0]} strings, expected {expected}")
    return ["".join(chr(c) for c in row).rstrip(" \x00") for row in mat]


def _is_matlab_layout(
    time_shape: tuple[int, ...], values_shape: tuple[int, ...], labels_shape: tuple[int, ...]
) -> bool:
    """Is this group stored column-major (MATLAB's ``exportHDF5``: every array's
    shape reversed)? Decided ONCE per group, never per matrix: a square values or
    labels matrix reads the same either way. ``time`` is always ``(n, 1)`` here
    (MATLAB: ``(1, n)``), so it decides when ``n > 1``. A single-point group has
    ``time`` ``(1, 1)`` in both layouts and falls back on ``values`` (``(1, m)``
    vs ``(m, 1)``), and a single point of a single channel on ``labels``
    (``(1, width)`` vs ``(width, 1)``)."""
    n = int(np.prod(time_shape))
    if n > 1:
        return time_shape == (1, n)
    for shape in (values_shape, labels_shape):
        if len(shape) == 2 and shape[0] != shape[1] and 1 in shape:
            return shape[1] == 1
    return False


def _read_data_group(group: Any, budget: Budget) -> DataStruct:
    for need in ("time", "values", "labels", "units"):
        if need not in group:
            raise ValueError(f"{group.name} is missing its {need!r} dataset")
    t_dset = same_file_child(group, "time", budget)
    v_dset = same_file_child(group, "values", budget)
    l_dset = same_file_child(group, "labels", budget)
    transposed = _is_matlab_layout(
        tuple(t_dset.shape), tuple(v_dset.shape), tuple(l_dset.shape)
    )
    time = read_numeric(f"{group.name}/time", t_dset, budget).reshape(-1)
    n = int(time.size)
    raw = read_numeric(f"{group.name}/values", v_dset, budget)
    raw = raw.reshape(1, -1) if raw.ndim == 1 else raw.reshape(raw.shape[0], -1)
    values: NDArray[np.float64] = raw.T if transposed else raw
    if values.shape[0] != n:
        raise ValueError(f"{group.name}/values has {values.shape[0]} rows for {n} time points")
    m = int(values.shape[1])
    declared = group.attrs.get("nChannels")
    if declared is not None and int(np.asarray(declared).reshape(-1)[0]) != m:
        raise ValueError(f"{group.name} declares {declared} channels but holds {m}")
    labels = _decode_strings(group, "labels", m, budget, transposed=transposed)
    units = _decode_strings(group, "units", m, budget, transposed=transposed)
    cat: dict[int, tuple[str, ...]] = {}
    for key, val in v_dset.attrs.items():
        if str(key).startswith("cat_levels_"):
            try:
                ch = int(str(key)[len("cat_levels_") :])
            except ValueError:
                continue
            levels = tuple(_text(v) for v in np.asarray(val).reshape(-1))
            if 0 <= ch < m and levels:
                cat[ch] = levels
    return DataStruct.create(time, values, labels=labels, units=units, cat_levels=cat or None)


def _own_metadata(h: Any, path: Path, budget: Budget) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_hdf5",
        "hdf5_schema": attr_str(h, "hdf5Schema"),
    }
    if "metadata" in h:
        mg = same_file_child(h, "metadata", budget)
        for attr, key in (
            ("xColumnName", "x_column_name"),
            ("xColumnUnit", "x_column_unit"),
            ("importDate", "import_date"),
        ):
            text = attr_str(mg, attr)
            if text:
                meta[key] = text
        original = attr_str(mg, "source")
        if original:
            meta["exported_from"] = original
        parser = attr_str(mg, "parserName")
        if parser:  # the original parser's name keeps its technique tag
            meta["parser_name"] = parser
    return meta


def _own_books(h: Any, path: Path, budget: Budget) -> list[DataStruct]:
    meta = _own_metadata(h, path, budget)
    raw = _read_data_group(same_file_child(h, "raw", budget), budget)
    corrections: dict[str, float] = {}
    if "corrections" in h:
        cgrp = same_file_child(h, "corrections", budget)
        for name in cgrp:
            scalar = read_numeric(name, same_file_child(cgrp, name, budget), budget)
            corrections[str(name)] = float(scalar.reshape(-1)[0])
    raw_meta = {**meta, "hdf5_group": "raw"}
    if corrections:
        raw_meta["hdf5_corrections"] = corrections
    books = [dataclasses.replace(raw, metadata=raw_meta)]
    if "corrected" in h:
        corr = _read_data_group(same_file_child(h, "corrected", budget), budget)
        books.append(
            dataclasses.replace(
                corr, metadata={**meta, "hdf5_group": "corrected", "sheet_name": "corrected"}
            )
        )
    if "peaks" in h:
        budget.notes.append("The file's /peaks table (peak-fit results) is not imported.")
    return books


def _is_quantized_export(h: Any) -> bool:
    return attr_str(h, "toolboxName") == "quantized" and "raw" in h


def read_hdf5_books(path: str | Path) -> list[DataStruct]:
    """Every importable book of the file, in file order (see module doc)."""
    p = Path(path)
    h = open_hdf5(p)
    budget = Budget()
    budget.bind(h)
    try:
        h5py = h5py_module()
        if _is_quantized_export(h):
            books = _own_books(h, p, budget)
        else:
            books = _tree_books(h5py, h, p, budget)
    finally:
        h.close()
    if len(books) > MAX_BOOKS:
        budget.notes.append(f"Only the first {MAX_BOOKS} of {len(books)} datasets were imported.")
        books = books[:MAX_BOOKS]
    if budget.notes:
        first = books[0]
        notes = [str(n) for n in first.metadata.get("notes", [])] + budget.notes
        books[0] = dataclasses.replace(first, metadata={**first.metadata, "notes": notes})
    return books


def _tree_books(h5py: Any, h: Any, path: Path, budget: Budget) -> list[DataStruct]:
    books: list[DataStruct] = []
    for gpath, group in walk_groups(h5py, h, budget):
        if len(books) >= MAX_BOOKS:
            break
        if attr_str(group, "NX_class") == "NXdata":
            try:
                books.append(nxdata_book(h5py, group, gpath, budget))
            except ValueError as exc:
                budget.notes.append(f"{exc}.")
            continue
        books.extend(generic_books(h5py, group, gpath, budget))
    if not books:
        why = " ".join(budget.notes) or "it holds no 1-D or 2-D numeric datasets"
        raise ValueError(f"nothing to import from {path.name}: {why}")
    return [
        dataclasses.replace(b, metadata={"source": str(path), **b.metadata}) for b in books
    ]


def import_hdf5(filepath: str | Path) -> DataStruct:
    """Import ``.h5`` / ``.hdf5`` / ``.nxs``: the first book (the registry's
    multi-dataset path offers the rest, ``read_hdf5_books``)."""
    return read_hdf5_books(filepath)[0]
