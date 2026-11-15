"""A DataStruct laid out as a worksheet table, and written to CSV/TSV/XLSX.

``io.table_export`` writes sheets the FRONTEND has already laid out
(``components/Stage/worksheet/worksheetTable.ts``). Headless callers -- the
``qz convert`` CLI and ``quantized.api.save_table`` -- have only a
DataStruct, so this module makes the same layout from one, column for
column:

* the X column first, named ``x_column_long`` / ``x_column_name`` (else
  ``"x"``), unit ``x_column_unit``, a date column when
  ``metadata["time_is_datetime"]`` is true;
* then every value channel, a categorical channel written as its level text;
* then the Origin text columns (``metadata["origin_text_columns"]``, named by
  ``origin_text_column_labels`` when the book has them), which is where the
  worksheet itself places them for an Origin book.

Rows are the longest of the numeric rows and the text columns; the shorter
side is padded with blanks, as in the worksheet. Pure ``io`` layer.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

import numpy as np

from quantized.csv_safe import with_excel_bom
from quantized.datastruct import DataStruct, is_categorical, level_of
from quantized.io.table_export import ExportColumn, ExportSheet, format_delimited, format_xlsx

__all__ = ["TABLE_SUFFIXES", "sheet_from_datastruct", "write_table"]

#: File suffix -> delimiter (``None`` = an Excel workbook).
TABLE_SUFFIXES: Mapping[str, str | None] = {".csv": ",", ".tsv": "\t", ".xlsx": None}


def _text_columns(ds: DataStruct) -> list[tuple[str, str, list[str]]]:
    """``(name, unit, cells)`` for each Origin text column, in stored order."""
    raw = ds.metadata.get("origin_text_columns")
    if not isinstance(raw, Mapping):
        return []
    labels = ds.metadata.get("origin_text_column_labels")
    labels = labels if isinstance(labels, Mapping) else {}
    out: list[tuple[str, str, list[str]]] = []
    for short, rows in raw.items():
        if not isinstance(rows, Sequence) or isinstance(rows, str):
            continue
        label = labels.get(short)
        label = label if isinstance(label, Mapping) else {}
        long_name = label.get("long_name")
        unit = label.get("unit")
        name = long_name if isinstance(long_name, str) and long_name else str(short)
        out.append((name, unit if isinstance(unit, str) else "", [str(c) for c in rows]))
    return out


def _numbers(values: np.ndarray, n_rows: int) -> list[float | str | None]:
    cells: list[float | str | None] = [float(v) for v in values]
    return cells + [None] * (n_rows - len(cells))


def sheet_from_datastruct(ds: DataStruct, name: str) -> ExportSheet:
    """``ds`` as one :class:`ExportSheet` called ``name`` (layout: module doc)."""
    meta = ds.metadata
    texts = _text_columns(ds)
    n_rows = max([ds.n_points, *(len(cells) for _, _, cells in texts)])
    x_name = meta.get("x_column_long") or meta.get("x_column_name") or "x"
    x_unit = meta.get("x_column_unit") or ""
    columns = [
        ExportColumn(
            name=str(x_name),
            unit=str(x_unit),
            kind="datetime" if meta.get("time_is_datetime") is True else "number",
            cells=_numbers(ds.time, n_rows),
        )
    ]
    for c, label in enumerate(ds.labels):
        unit = ds.units[c] if c < len(ds.units) else ""
        if is_categorical(ds, c):
            levels: list[float | str | None] = [
                level_of(ds, c, float(v)) or "" for v in ds.values[:, c]
            ]
            cells = levels + [None] * (n_rows - len(levels))
            columns.append(ExportColumn(name=label, unit=unit, kind="text", cells=cells))
        else:
            columns.append(
                ExportColumn(
                    name=label, unit=unit, kind="number", cells=_numbers(ds.values[:, c], n_rows)
                )
            )
    for text_name, unit, rows in texts:
        padded: list[float | str | None] = [*rows, *([""] * (n_rows - len(rows)))]
        columns.append(ExportColumn(name=text_name, unit=unit, kind="text", cells=padded))
    return ExportSheet(name=name, columns=columns)


def write_table(
    sheets: Sequence[tuple[str, DataStruct]], path: Path, *, header: bool = True
) -> Path:
    """Write ``(sheet name, DataStruct)`` pairs to ``path`` by its suffix.

    ``.xlsx`` writes one workbook, a tab per sheet. ``.csv``/``.tsv`` hold one
    sheet, so more than one is a ``ValueError`` (write one file per sheet).
    ``header`` writes the Long Name and Units rows, which the importers read
    back. Returns ``path``.
    """
    suffix = path.suffix.lower()
    if suffix not in TABLE_SUFFIXES:
        raise ValueError(f"unsupported table format {suffix or path.name!r} (csv, tsv or xlsx)")
    if not sheets:
        raise ValueError("nothing to write")
    tables = [sheet_from_datastruct(ds, name) for name, ds in sheets]
    delimiter = TABLE_SUFFIXES[suffix]
    if delimiter is None:
        path.write_bytes(format_xlsx(tables, header=header))
        return path
    if len(tables) != 1:
        raise ValueError(f"a {suffix} file holds one sheet, got {len(tables)}")
    # The app's own worksheet export bytes: a BOM only for non-ASCII text
    # (routes/export_table.py), "\n" rows exactly as the csv module wrote them.
    text = with_excel_bom(format_delimited(tables[0], delimiter, header=header))
    path.write_bytes(text.encode("utf-8"))
    return path
