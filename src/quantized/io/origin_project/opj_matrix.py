"""Origin matrix books in ``.opj`` (CPYA): dimensions, coordinates, map dataset.

A matrix sheet's cells are ONE dataset, named after its window
(``MBook1``; sheet N > 1 is ``MBook1@N``) — no ``_<Col>`` part — holding
``rows * cols`` values row-major, in any of the numeric cell types
``opj_datasets`` decodes. Its shape is not in the dataset; it is in the
window's sheet sub-header (the block carrying ``Pd<SheetName>`` at 0xD0):

* byte 2 has ``0x80`` set on a matrix sheet (``0xDE``; a worksheet sheet is
  ``0x5E``, graph layers ``0x1F``/``0x5F``/...),
* u16 at 0x2B = columns, u32 at 0x52 = rows.

The X/Y coordinate mapping follows as four named records (``X1``, ``X2``,
``Y1``, ``Y2`` at 0x46 of a 133-byte record, 111 bytes at CPYA 4.2878), each
followed by a block holding that number as text. Origin maps columns
linearly from X1 (first column) to X2 (last) and rows from Y1 to Y2.

Oracles (expected values read from Altaxo's LibOriginCSharp tests at test
time; no GPL code consulted, no specimen value reproduced here): the
``Matrix71x29`` and ``Matrix137x179`` specimens (column / row counts, the
four coordinate bounds, individual cells by [row, column]),
``OneWorksheetOneMatrix`` (every cell of a small matrix beside a
worksheet), ``Matrix2x3OfDifferentTypes`` (the same matrix stored in each
of the nine numeric cell types, complex included). See
``tests/test_io_origin_opj_corpus.py``.

Fail closed: a matrix is decoded only when ``rows * cols`` equals the
dataset's row count exactly; anything else is reported, never reshaped on a
guess. The result is the map point cloud every other 2-D importer returns
(``io/_map_schema.py``): one row per cell, columns X, Y, Z.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io.origin_project.windows import _is_sheet_header, _is_window_header

__all__ = ["MatrixSheet", "build_matrix_book", "matrix_sheets"]

_MATRIX_FLAG = 0x80
_RECORD_NAME_OFFSET = 0x46
_COORD_NAMES = (b"X1", b"X2", b"Y1", b"Y2")


@dataclass
class MatrixSheet:
    """One matrix sheet's shape + coordinate mapping (None = not recovered)."""

    name: str
    rows: int
    cols: int
    x1: float | None = None
    x2: float | None = None
    y1: float | None = None
    y2: float | None = None


def _coordinate(payload: bytes) -> float | None:
    text = payload.split(b"\x00", 1)[0]
    try:
        value = float(text.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        return None
    return value if np.isfinite(value) else None


def matrix_sheets(blocks: Sequence[tuple[int, bytes]]) -> dict[str, list[MatrixSheet]]:
    """Window short name -> its matrix sheets, in file (= sheet) order.

    Only windows with at least one matrix sheet appear. A coordinate record
    belongs to the matrix sheet most recently opened in the same window.
    """
    out: dict[str, list[MatrixSheet]] = {}
    window: str | None = None
    sheet: MatrixSheet | None = None
    for i, (size, payload) in enumerate(blocks):
        if size == 0:
            continue
        header = _is_window_header(payload)
        if header is not None:
            window, sheet = header, None
            continue
        if window is None:
            continue
        sheet_name = _is_sheet_header(payload)
        if sheet_name is not None:
            sheet = None
            if payload[2] & _MATRIX_FLAG:
                cols = struct.unpack_from("<H", payload, 0x2B)[0]
                rows = struct.unpack_from("<I", payload, 0x52)[0]
                sheet = MatrixSheet(sheet_name, rows, cols)
                out.setdefault(window, []).append(sheet)
            continue
        if sheet is None or len(payload) <= _RECORD_NAME_OFFSET + 3 or i + 1 >= len(blocks):
            continue
        name = payload[_RECORD_NAME_OFFSET : _RECORD_NAME_OFFSET + 3]
        if name[2] == 0 and name[:2] in _COORD_NAMES:
            setattr(sheet, name[:2].decode().lower(), _coordinate(blocks[i + 1][1]))
    return out


def _axis(lo: float | None, hi: float | None, n: int) -> tuple[NDArray[np.float64], bool]:
    """``n`` coordinates from ``lo`` to ``hi``; 1..n (flagged) when unknown."""
    if lo is None or hi is None:
        return np.arange(1, n + 1, dtype=np.float64), False
    return np.asarray(np.linspace(lo, hi, n), dtype=float), True


def build_matrix_book(
    book: str,
    long_name: str,
    sheet: MatrixSheet,
    cells: NDArray[np.float64],
    imag: NDArray[np.float64] | None,
    inventory: list[dict[str, object]],
) -> DataStruct:
    """The map DataStruct for one matrix sheet (``cells`` row-major)."""
    x, x_known = _axis(sheet.x1, sheet.x2, sheet.cols)
    y, y_known = _axis(sheet.y1, sheet.y2, sheet.rows)
    columns = [np.tile(x, sheet.rows), np.repeat(y, sheet.cols), cells]
    labels = ["X", "Y", "Z"]
    if imag is not None:
        columns.append(imag)
        labels.append("Z (imaginary)")
    values = np.column_stack(columns)
    metadata: dict[str, object] = {
        "source_format": "origin_opj",
        "origin_book": book,
        "origin_book_long": long_name,
        "origin_books": inventory,
        "x_column_name": "X",
        "is2D": True,
        "map_shape": [sheet.rows, sheet.cols],
        "axis1_name": "Y",
        "axis2_name": "X",
        "default_value_channels": [2],
        "default_trace": "Scatter",
        "origin_matrix": {
            "sheet": sheet.name,
            "rows": sheet.rows,
            "cols": sheet.cols,
            "x_range": [float(x[0]), float(x[-1])] if x.size else [],
            "y_range": [float(y[0]), float(y[-1])] if y.size else [],
            # False = the X1/X2/Y1/Y2 records were not found, so the axis is
            # the 1-based cell index, not Origin's coordinate mapping.
            "coordinates_recovered": x_known and y_known,
        },
    }
    return DataStruct.create(
        np.asarray(values[:, 0], dtype=float),
        values,
        labels=labels,
        units=[""] * len(labels),
        metadata=metadata,
    )
