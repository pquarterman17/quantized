"""The SQLite output of the quick converter (stdlib ``sqlite3``, no dependency).

One ``.sqlite`` file holds every dataset:

* ``datasets(name, table_name, n_points, metadata)`` -- one row per dataset;
  ``metadata`` is JSON (``convert_meta.jsonable``, so ``NaN`` is ``null`` and
  an infinity the string ``"Infinity"``), minus the private keys;
* ``channels(dataset, position, label, unit, role, levels)`` -- ``role`` is
  ``x`` for the independent column and ``y`` for a value channel; ``levels``
  is a JSON list for a categorical channel, whose column then holds its level
  codes;
* one data table per dataset, named in ``datasets.table_name``: column ``x``
  (the dataset's ``.time``), then one column per channel in order
  (``channels.position`` 1..n; a duplicate label gets ``~2``). A gap (``NaN``)
  is ``NULL``; an infinity is kept.

A 2-D map is written as its rows (the lossless long table); its
``map_shape`` is in ``datasets.metadata``. Pure ``io``.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct, is_categorical
from quantized.io.convert_meta import jsonable, public_metadata, x_label
from quantized.io.convert_plan import safe_name, unique_name
from quantized.x_units import x_unit_of

__all__ = ["write_sqlite"]


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _cells(column: NDArray[np.float64]) -> list[float | None]:
    """A column as SQL values; ``NaN`` (a gap) is ``NULL``."""
    return [None if np.isnan(v) else float(v) for v in np.asarray(column, dtype=float)]


def _columns(ds: DataStruct) -> list[tuple[str, str, str, str, str | None, NDArray[np.float64]]]:
    """``(column name, label, unit, role, levels JSON, numbers)``: x, then channels."""
    out: list[tuple[str, str, str, str, str | None, NDArray[np.float64]]] = [
        ("x", x_label(ds), x_unit_of(ds), "x", None, ds.time)
    ]
    taken = {"x"}
    for c, label in enumerate(ds.labels):
        levels = (
            json.dumps(list(ds.cat_levels[c]), ensure_ascii=False)
            if is_categorical(ds, c) and ds.cat_levels
            else None
        )
        unit = ds.units[c] if c < len(ds.units) else ""
        col = unique_name(label or f"ch{c + 1}", taken)
        out.append((col, label, unit, "y", levels, ds.values[:, c]))
    return out


def write_sqlite(path: Path, datasets: Sequence[tuple[str, DataStruct]]) -> None:
    """``datasets`` as one SQLite database (layout: module doc)."""
    with contextlib.closing(sqlite3.connect(path)) as con:
        con.execute(
            "CREATE TABLE datasets (name TEXT PRIMARY KEY, table_name TEXT NOT NULL, "
            "n_points INTEGER NOT NULL, metadata TEXT NOT NULL)"
        )
        con.execute(
            "CREATE TABLE channels (dataset TEXT NOT NULL, position INTEGER NOT NULL, "
            "label TEXT NOT NULL, unit TEXT NOT NULL, role TEXT NOT NULL, levels TEXT)"
        )
        tables = {"datasets", "channels"}
        for name, ds in datasets:
            table = unique_name(safe_name(name), tables)
            cols = _columns(ds)
            defs = ", ".join(f"{_quote(c[0])} REAL" for c in cols)
            con.execute(f"CREATE TABLE {_quote(table)} ({defs})")
            marks = ", ".join("?" for _ in cols)
            rows = zip(*(_cells(c[5]) for c in cols), strict=True)
            con.executemany(f"INSERT INTO {_quote(table)} VALUES ({marks})", rows)
            meta = json.dumps(jsonable(public_metadata(ds.metadata)), ensure_ascii=False)
            con.execute(
                "INSERT INTO datasets VALUES (?, ?, ?, ?)", (name, table, int(ds.n_points), meta)
            )
            con.executemany(
                "INSERT INTO channels VALUES (?, ?, ?, ?, ?, ?)",
                [(name, pos, c[1], c[2], c[3], c[4]) for pos, c in enumerate(cols)],
            )
        con.commit()
