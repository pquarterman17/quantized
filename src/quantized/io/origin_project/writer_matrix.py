"""Matrix books in the native ``.opj`` writer: a matrix the reader imported
goes back out as an Origin matrix, not as X/Y/Z worksheet columns.

The layout is the one ``opj_matrix`` reads (``docs/origin_project_format.md``
§3.1.1): the cells are ONE dataset named after the window (``MBook1``),
``rows * cols`` values row-major; the window's sheet sub-header carries the
matrix flag (byte 2 = ``0xDE``), the columns (u16 @0x2B) and rows (u32
@0x52); the X/Y mapping follows as four coordinate records named ``Y2``,
``X2``, ``Y1``, ``X1`` at 0x46, each followed by a block holding the number
as text and two NULL blocks. Census of every matrix window in the public
``.opj`` corpus (9 files, 2026-11-14): all 96 coordinate records are 133
bytes opening ``00 00 06 00`` and are followed by that text block and two
NULLs; all 24 matrix property blocks carry the dataset serial at @4, 0 at
@30/@35/@51/@0x11, ``0x60`` at @38 and no short name. Those are the values
written here; every other byte is the writer's sanitized worksheet template
(``writer_blocks``). No specimen bytes are copied.

Only a dataset that still IS that grid is written as a matrix: the
reader's X/Y/Z point cloud (``opj_matrix.build_matrix_book``) — three
channels ``X``, ``Y``, ``Z``, ``rows * cols`` points, X repeating one
linear row of column coordinates, Y holding each row's coordinate across it.
A sorted, filtered or complex matrix, or one exported as a sheet of a
larger workbook, goes out as worksheet columns and is counted
(:func:`matrix_fallbacks`). Loading in real Origin has not been probed for
the matrix window (the worksheet window is, §8).
"""

from __future__ import annotations

import re
import struct
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io.origin_project import writer_blocks as wb

__all__ = ["MatrixGrid", "matrix_fallbacks", "matrix_grid", "matrix_window"]

_MATRIX_SHEET = 0xDE
_COORD_HEAD = bytes.fromhex("00000600")
_COORD_ORDER = ("Y2", "X2", "Y1", "X1")
_NULL = struct.pack("<I", 0) + b"\n"
_SHEET_NAME = re.compile(r"[A-Za-z][A-Za-z0-9]{0,23}")  # kept when it is a plain short name


@dataclass(frozen=True)
class MatrixGrid:
    """A matrix's shape, cells (row-major) and X/Y bounds (None: the axes
    are the 1-based cell index — no coordinate records are written)."""

    rows: int
    cols: int
    cells: NDArray[np.float64]
    bounds: tuple[float, float, float, float] | None  # x1, x2, y1, y2
    sheet: str = "MSheet1"


def _is_matrix(ds: DataStruct) -> bool:
    return ds.metadata.get("origin_matrix") is not None


def matrix_grid(ds: DataStruct) -> MatrixGrid | None:
    """The grid ``ds`` holds, or None when it is not (or no longer) one."""
    info = ds.metadata.get("origin_matrix")
    if not isinstance(info, dict) or tuple(ds.labels) != ("X", "Y", "Z"):
        return None
    rows, cols = info.get("rows"), info.get("cols")
    values = np.asarray(ds.values, dtype=float)
    if not isinstance(rows, int) or not isinstance(cols, int) or rows < 1 or cols < 1:
        return None
    if values.shape != (rows * cols, 3):
        return None
    xs, ys = values[:cols, 0], values[::cols, 1]
    if not (np.array_equal(values[:, 0], np.tile(xs, rows))
            and np.array_equal(values[:, 1], np.repeat(ys, cols))):  # fmt: skip
        return None
    if not (_linear(xs) and _linear(ys)):
        return None
    on_indices = np.array_equal(xs, np.arange(1, cols + 1))
    on_indices = on_indices and np.array_equal(ys, np.arange(1, rows + 1))
    unknown = on_indices and not info.get("coordinates_recovered", True)
    bounds = None if unknown else (float(xs[0]), float(xs[-1]), float(ys[0]), float(ys[-1]))
    sheet = info.get("sheet")
    name = sheet if isinstance(sheet, str) and _SHEET_NAME.fullmatch(sheet) else "MSheet1"
    return MatrixGrid(rows, cols, np.asarray(values[:, 2], dtype=float), bounds, name)


def _linear(axis: NDArray[np.float64]) -> bool:
    if axis.size < 2:
        return bool(np.isfinite(axis).all())
    line = np.linspace(axis[0], axis[-1], axis.size)
    return bool(np.isfinite(axis).all() and np.allclose(axis, line, rtol=1e-12, atol=0.0))


def matrix_fallbacks(books: Sequence[DataStruct], groups: Sequence[str] | None) -> int:
    """How many matrix books go out as worksheet columns instead."""
    keys = list(groups) if groups is not None else [""] * len(books)
    shared = {k for k in keys if k and keys.count(k) > 1}
    return sum(
        1 for ds, key in zip(books, keys, strict=True)
        if _is_matrix(ds) and (key in shared or matrix_grid(ds) is None)
    )  # fmt: skip


def _subheader(grid: MatrixGrid) -> bytes:
    p = bytearray(wb.sheet_subheader(grid.rows, grid.sheet, 1))
    p[2] = _MATRIX_SHEET
    struct.pack_into("<H", p, 0x2B, grid.cols)
    struct.pack_into("<I", p, 0x52, grid.rows)
    return bytes(p)


def _coordinate(name: str, value: float) -> bytes:
    rec = bytearray(wb._GRP_133)
    rec[0:4] = _COORD_HEAD
    rec[0x46 : 0x46 + 24] = bytes(24)
    rec[0x46 : 0x46 + 3] = name.encode("ascii") + b"\x00"
    text = repr(value).removesuffix(".0").encode("ascii") + b"\x00"
    return wb.make_block(bytes(rec)) + wb.make_block(text) + _NULL * 2


def _prop(serial: int) -> bytes:
    p = bytearray(wb.prop_block(serial, "", 0, 0, 0))
    struct.pack_into("<H", p, 30, 0)
    p[38] = 0x60
    return bytes(p)


def matrix_window(short: str, long_name: str, grid: MatrixGrid, serial: int) -> bytes:
    """One matrix window section (header to its property block)."""
    out = wb.make_block(wb.window_header(short, long_name)) + wb.make_block(_subheader(grid))
    out += wb.sheet_storage_group()
    if grid.bounds is not None:
        x1, x2, y1, y2 = grid.bounds
        for name, value in zip(_COORD_ORDER, (y2, x2, y1, x1), strict=True):
            out += _coordinate(name, value)
    return out + _NULL + wb.make_block(_prop(serial))
