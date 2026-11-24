"""The flat and workbook outputs of the quick converter: CSV, ``.xy``, Excel.

* **CSV** -- the worksheet layout of ``io/datastruct_table.py`` (Long Name and
  Units rows) under a ``#``-comment header of the metadata, ``# key: value``
  per line (nested keys dotted; a value over ``convert_meta.MAX_TEXT``
  characters is cut and the key listed on a ``# truncated:`` line).
* **``.xy``** -- whitespace-separated numbers, ``X Y1 Y2 ...``, one row per
  point, the same ``#`` header, then one ``# column k: name [unit]`` line per
  column. Numbers are written in their shortest round-trip form, ``nan`` for a
  gap; a categorical channel is written as its level codes, the levels listed
  on a ``# column k levels:`` line; text columns (Origin) are not written.
* **Excel** -- a tab per dataset, then a ``metadata`` sheet
  (``dataset | key | value``); a 2-D map also gets a ``<name> grid`` tab, its
  signal as an ``n_frames x n_pixels`` matrix.

**2-D maps** are written as the long table the parser already holds: one row
per point, each coordinate and signal a column (e.g. 2Theta, Omega,
Intensity, Qx, Qz). ``.time`` is dropped from it when it is a copy of one of
those columns (it always is, for a map), so nothing is lost and nothing is
duplicated. Pure ``io``.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence

import numpy as np

from quantized.csv_safe import with_excel_bom
from quantized.datastruct import DataStruct, is_categorical, level_of
from quantized.io.convert_maps import is_map, map_grid, signal_channel, time_is_channel
from quantized.io.convert_meta import flatten_metadata
from quantized.io.datastruct_table import has_x_column, sheet_from_datastruct
from quantized.io.table_export import (
    ExportColumn,
    ExportSheet,
    format_delimited,
    format_xlsx,
)
from quantized.x_units import x_unit_of

__all__ = ["format_csv", "format_workbook", "format_xy", "long_table_sheet"]


def _comment_lines(ds: DataStruct, name: str) -> list[str]:
    rows, cut = flatten_metadata(ds.metadata)
    lines = [f"# quantized-convert: dataset={name}"]
    lines += [f"# {key}: {text}" for key, text in rows]
    if cut:
        lines.append(f"# truncated: {', '.join(cut)}")
    return lines


def long_table_sheet(ds: DataStruct, name: str) -> ExportSheet:
    """``ds`` as a worksheet; a map's duplicated ``.time`` column is dropped."""
    sheet = sheet_from_datastruct(ds, name)
    if is_map(ds) and has_x_column(ds) and time_is_channel(ds):
        sheet = dataclasses.replace(sheet, columns=list(sheet.columns)[1:])
    return sheet


def format_csv(ds: DataStruct, name: str, *, metadata: bool = True) -> bytes:
    """One dataset as CSV bytes (UTF-8, a BOM only for non-ASCII text)."""
    sheet = long_table_sheet(ds, name)
    if metadata:
        sheet = dataclasses.replace(sheet, preamble=(*_comment_lines(ds, name), *sheet.preamble))
    return with_excel_bom(format_delimited(sheet, ",")).encode("utf-8")


def _xy_columns(ds: DataStruct) -> list[tuple[str, str, np.ndarray, str]]:
    """``(name, unit, numbers, levels text)`` per written column."""
    cols: list[tuple[str, str, np.ndarray, str]] = []
    if has_x_column(ds) and not (is_map(ds) and time_is_channel(ds)):
        meta = ds.metadata
        x_name = str(meta.get("x_column_long") or meta.get("x_column_name") or "x")
        cols.append((x_name, x_unit_of(ds), ds.time, ""))
    for c, label in enumerate(ds.labels):
        levels = ""
        if is_categorical(ds, c):
            n = len(ds.cat_levels[c]) if ds.cat_levels else 0
            levels = "|".join(level_of(ds, c, float(k)) or "" for k in range(n))
        unit = ds.units[c] if c < len(ds.units) else ""
        cols.append((label, unit, ds.values[:, c], levels))
    return cols


def format_xy(ds: DataStruct, name: str, *, metadata: bool = True) -> bytes:
    """One dataset as ``.xy`` / ``.txt`` bytes (layout: module doc)."""
    cols = _xy_columns(ds)
    if not cols:
        raise ValueError("the dataset has no numeric column to write")
    lines = _comment_lines(ds, name) if metadata else [f"# quantized-convert: dataset={name}"]
    for k, (cname, unit, _, levels) in enumerate(cols, 1):
        lines.append(f"# column {k}: {cname}" + (f" [{unit}]" if unit else ""))
        if levels:
            lines.append(f"# column {k} levels (value = index): {levels}")
    n = len(cols[0][2])
    for i in range(n):
        lines.append(" ".join(repr(float(arr[i])) for _, _, arr, _ in cols))
    return ("\n".join(line.replace("\r", " ") for line in lines) + "\n").encode("utf-8")


def _grid_sheet(ds: DataStruct, name: str) -> ExportSheet | None:
    grid = map_grid(ds)
    if grid is None:
        return None
    z = grid[signal_channel(ds)]
    columns = [
        ExportColumn(name=f"{k + 1}", unit="", kind="number", cells=[float(v) for v in z[:, k]])
        for k in range(z.shape[1])
    ]
    return ExportSheet(name=f"{name[:24]} grid", columns=columns)


def format_workbook(sheets: Sequence[tuple[str, DataStruct]], *, metadata: bool = True) -> bytes:
    """``(tab name, DataStruct)`` pairs as one workbook (layout: module doc).
    Tab names are the caller's, already unique and Excel-safe."""
    tables: list[ExportSheet] = []
    rows: list[tuple[str, str, str]] = []
    for name, ds in sheets:
        tables.append(long_table_sheet(ds, name))
        grid = _grid_sheet(ds, name)
        if grid is not None:
            tables.append(grid)
        if metadata:
            flat, _ = flatten_metadata(ds.metadata)
            rows += [(name, key, text) for key, text in flat]
    if rows:
        cells = [[r[i] for r in rows] for i in range(3)]
        tables.append(
            ExportSheet(
                name="metadata",
                columns=[
                    ExportColumn(name=head, unit="", kind="text", cells=list(col))
                    for head, col in zip(("dataset", "key", "value"), cells, strict=True)
                ],
            )
        )
    return format_xlsx(tables)
