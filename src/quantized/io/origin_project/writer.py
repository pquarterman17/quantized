"""Write Origin ``.opj`` (CPYA) projects from DataStructs (plan item 24/34).

Origin >= 2023 dropped *writing* ``.opj`` but still *reads* it, so one CPYA
writer reaches every Origin version — the "hand a file back to Origin
colleagues" path. The emitted container follows the loader model pinned by
the 2026-07-07 PN/PQ COM probe series (``docs/origin_re/validation_log.md``
+ ``writer_blocks.py``): stream = header line + fh block + per-column
``[NULL][147B header][data]`` triples + ``NULL NULL`` + per-book window
sections + ``NULL NULL NULL``; then the full tail (params, project record,
the loader-required ``ResultsLog`` note, folder tree, 8-record global
storage) and the file-size u32 patched into fh offset 115.

Round-trip through :func:`quantized.io.origin_project.read_origin_books` is
CI-tested; loading in REAL Origin (COM ``app.Load``) is verified live per
license window (validation log) — the probe series this layout ships from
loaded ``True`` on Origin 2026b.

Column roles follow the dataset's declared designations
(``io/_column_roles``: ``column_designations`` + the live ``error_roles``):
Y, Y-error, X-error, label, disregard, Z, and a second X column (which opens
a new X group its following Y columns bind to -- the reader's
nearest-preceding-X rule). Column comments are written to the label block's
third row. Text is Latin-1 with Origin's ``\\(xHHHH)`` escape for anything
else (``writer_blocks.encode_text``), never ``?``. Multi-X / non-Y
designations round-trip through the reader in CI; the live-Origin probe
series above covered X/Y books only.
"""

from __future__ import annotations

import re
import struct
from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._column_roles import (
    channel_comments,
    channel_designations,
    column_letter,
    x_column_comment,
)
from quantized.io.origin_project import writer_blocks as wb
from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["opj_bytes", "write_opj"]

_HEADER_LINE = b"CPYA 4.3380 188 W64 #\n"
_DESIGNATION_CODE = {"Y": 0, "disregard": 1, "Y-error": 2, "X": 3, "label": 4, "Z": 5, "X-error": 6}
_NULL = struct.pack("<I", 0) + b"\n"


# Origin short (window) names: ASCII letters/digits only, starting with a
# letter -- no spaces or punctuation (Origin's Short Name rule). Capped so
# the ``<book>_<column>`` dataset name fits the 147B header's 23-byte field
# even for a 3-letter column (AAA): 16 + 1 + 3 + NUL < 23.
_SHORT_MAX = 16
_NOT_ALNUM = re.compile(r"[^A-Za-z0-9]")


def _col_short(i: int) -> str:
    """0-based column index -> Origin short name, bijective base-26
    (A..Z, AA, AB, …) — the same lettering the readers decode. (The old
    A..Z-only table made the writer reject >26-column books that the read
    path handles fine; 2026-07-06 genericity audit.)"""
    return column_letter(i)


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _data_block(values: np.ndarray) -> bytes:
    vals = np.asarray(values, dtype="<f8").copy()
    vals[np.isnan(vals)] = ORIGIN_MISSING
    rows = np.zeros((len(vals), 10), dtype=np.uint8)
    rows[:, 2:] = vals.view(np.uint8).reshape(len(vals), 8)
    return _block(rows.tobytes())


def _label_block(long_name: str, unit: str, comment: str) -> bytes:
    rows = [wb.encode_text(t) for t in (long_name, unit, comment)]
    text = b"\r\n".join(rows).rstrip(b"\r\n") or b" "
    return _block(text + b"\x00")


def _book_name(ds: DataStruct, index: int, used: set[str]) -> tuple[str, str]:
    """(short, long) book names. The short name obeys Origin's rule (ASCII
    letters/digits, leading letter, no spaces) and is unique ignoring case
    (Origin names are case-insensitive); the long name keeps the original
    text, so a renamed short name loses nothing the user sees."""
    raw = str(ds.metadata.get("origin_book", "") or f"Book{index + 1}")
    short = _NOT_ALNUM.sub("", raw)
    if short and not short[0].isalpha():
        short = "B" + short
    short = (short or f"Book{index + 1}")[:_SHORT_MAX]
    base = short
    n = 1
    while short.lower() in used:
        n += 1
        short = f"{base[: _SHORT_MAX - len(str(n))]}{n}"
    used.add(short.lower())
    long_name = str(ds.metadata.get("origin_book_long", "") or raw)
    return short, long_name


def _x_label(ds: DataStruct) -> tuple[str, str]:
    """The X (time) column's long name + unit: the Origin keys
    (``x_column_long``/``x_unit``) first, then the canonical keys every other
    parser writes (``x_column_name``/``x_column_unit``)."""
    meta = ds.metadata
    long_name = meta.get("x_column_long") or meta.get("x_column_name") or ""
    unit = meta.get("x_unit") or meta.get("x_column_unit") or ""
    return str(long_name), str(unit)


def _columns(ds: DataStruct) -> list[tuple[str, str, str, str, str]]:
    """``(short, long, unit, designation, comment)`` per worksheet column:
    the X/time column A, then one per value channel with its declared
    designation (``io/_column_roles``) and comment."""
    labels = [str(lb) for lb in ds.labels]
    desig = channel_designations(ds.metadata, labels)
    comments = channel_comments(ds.metadata, ds.values.shape[1])
    x_long, x_unit = _x_label(ds)
    cols = [(_col_short(0), x_long, x_unit, "X", x_column_comment(ds.metadata))]
    for j in range(ds.values.shape[1]):
        label = labels[j] if j < len(labels) else ""
        unit = str(ds.units[j]) if j < len(ds.units) else ""
        d = desig[j] if j < len(desig) else "Y"
        cols.append((_col_short(j + 1), label, unit, d, comments[j]))
    return cols


def opj_bytes(books: list[DataStruct]) -> bytes:
    """Serialize DataStructs as a CPYA ``.opj`` project (one workbook each).

    Column 0 of every book is the DataStruct's ``time`` (designation X, named
    by ``x_column_long``/``x_unit``, else ``x_column_name``/``x_column_unit``);
    the value columns follow with their labels, units, comments and declared
    designations. Short designations run A, B, C, …
    """
    if not books:
        raise ValueError("opj_bytes needs at least one DataStruct")
    out = bytearray(_HEADER_LINE)
    out += _block(wb.FH_123)
    used: set[str] = set()
    named: list[tuple[str, str, DataStruct, list[tuple[str, str, str, str, str]]]] = []
    serial = 0  # global column counter: 147B header id + 519B property serial

    for i, ds in enumerate(books):
        short_book, long_book = _book_name(ds, i, used)
        cols = _columns(ds)
        named.append((short_book, long_book, ds, cols))

        # datasets section: [NULL][147B column header][data] per column
        arrays = [np.asarray(ds.time, dtype=float)] + [
            np.asarray(ds.values[:, j], dtype=float) for j in range(ds.values.shape[1])
        ]
        for (short, _lng, _unit, _desig, _cmt), arr in zip(cols, arrays, strict=True):
            serial += 1
            out += _NULL
            out += _block(wb.col_header(f"{short_book}_{short}", len(arr), serial))
            out += _data_block(arr)

    out += _NULL * 2  # datasets / windows section separator

    # windows section: per book a window section; a WORKSHEET section is
    # followed by 6 NULLs before the next section (graph sections use 2 —
    # measured across every Moke window; with 2 the loader folds the next
    # book into the previous one: PW1 probe, books=1 -> 2)
    serial = 0
    for k, (short_book, long_book, ds, cols) in enumerate(named):
        if k:
            out += _NULL * 6
        out += _block(wb.window_header(short_book, long_book))
        out += _block(wb.sheet_subheader(len(ds.time)))
        out += wb.sheet_storage_group()
        out += _NULL  # closes the record-group run (real files: group NULL + one)
        # Each column binds to its nearest-preceding X (column A first; a
        # later X-designated column opens the next X group).
        x_serial, x_group = 0, 0
        for short, long_name, unit, desig, comment in cols:
            serial += 1
            if desig == "X":
                x_serial, x_group = serial, x_group + 1
            out += _block(
                wb.prop_block(serial, short, _DESIGNATION_CODE[desig], x_serial, x_group)
            )
            out += _label_block(long_name, unit, comment)
    out += _NULL * 3  # closes the windows section (stream end)

    out += wb.tail(len(named))
    struct.pack_into("<I", out, wb.fh_size_offset(_HEADER_LINE), len(out))
    return bytes(out)


def write_opj(books: list[DataStruct], path: Path) -> None:
    """Write ``books`` to ``path`` as an Origin ``.opj`` project."""
    Path(path).write_bytes(opj_bytes(books))
