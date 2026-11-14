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
else (``writer_blocks.encode_text``), never ``?``.

**What is verified where.** Loading in REAL Origin was probed live for
single-X books of X and Y columns with Latin-1 names/units only. Everything
this module writes beyond that -- a second X group, Y-error / X-error /
label / disregard / Z columns, column comments, ``\\(xHHHH)`` and
``\\(64)`` escapes, escaped book titles, sanitized short names, a
workbook of several sheets (``opj_bytes`` ``groups``; the sheet layout and
the sheet-id byte follow the corpus' multi-sheet books) -- is
verified ONLY by round-trip through our own reader (CI) plus, for the
property-block association fields, agreement with real Origin-written files
in the local corpus (``writer_blocks.prop_block``). None of it has been
opened in Origin yet.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._column_roles import (
    channel_comments,
    channel_designations,
    column_letter,
    x_column_comment,
)
from quantized.io._origin_names import origin_short_name
from quantized.io.origin_project import writer_blocks as wb
from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["opj_bytes", "write_opj"]

_HEADER_LINE = b"CPYA 4.3380 188 W64 #\n"
_DESIGNATION_CODE = {"Y": 0, "disregard": 1, "Y-error": 2, "X": 3, "label": 4, "Z": 5, "X-error": 6}
_NULL = struct.pack("<I", 0) + b"\n"


# Origin short (window) names: io/_origin_names.origin_short_name.


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
    # A sheet pseudo-book ("Book1@2", one sheet exported on its own) is named
    # after its base book: the "@" would otherwise fold into "Book12".
    raw = str(ds.metadata.get("origin_book", "") or f"Book{index + 1}").partition("@")[0]
    raw = raw or f"Book{index + 1}"
    short = origin_short_name(raw, f"Book{index + 1}", used)
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


_Column = tuple[str, str, str, str, str]
# One worksheet window: (short name, long name, its sheets as (DataStruct,
# columns) in sheet-id order 1..n).
_Window = tuple[str, str, list[tuple[DataStruct, list[_Column]]]]


def _plan_windows(books: list[DataStruct], groups: Sequence[str] | None) -> list[_Window]:
    """Group ``books`` into worksheet windows: books sharing a non-empty
    ``groups`` key become the sheets of ONE window (first-seen order), named
    after the first of them; every other book is a window of its own."""
    keys = list(groups) if groups is not None else [""] * len(books)
    if len(keys) != len(books):
        raise ValueError("opj_bytes: one group key per book")
    members: dict[str, list[int]] = {}
    order: list[list[int]] = []
    for i, key in enumerate(keys):
        if key and key in members:
            members[key].append(i)
            continue
        slot = [i]
        if key:
            members[key] = slot
        order.append(slot)
    used: set[str] = set()
    windows: list[_Window] = []
    for slot in order:
        short, long_name = _book_name(books[slot[0]], len(windows), used)
        windows.append((short, long_name, [(books[i], _columns(books[i])) for i in slot]))
    return windows


def opj_bytes(books: list[DataStruct], groups: Sequence[str] | None = None) -> bytes:
    """Serialize DataStructs as a CPYA ``.opj`` project.

    Each DataStruct is one worksheet sheet. Books that share a non-empty
    ``groups`` key are the sheets of one workbook window (sheet ``k`` of it
    stores its columns as ``<Book>_<Col>@k`` and carries id ``k`` in its
    sub-header, ``writer_blocks.sheet_subheader``); without ``groups``
    every DataStruct is a workbook of its own, as before.

    Column 0 of every sheet is the DataStruct's ``time`` (designation X,
    named by ``x_column_long``/``x_unit``, else ``x_column_name``/
    ``x_column_unit``); the value columns follow with their labels, units,
    comments and declared designations. Short designations run A, B, C, …
    """
    if not books:
        raise ValueError("opj_bytes needs at least one DataStruct")
    windows = _plan_windows(books, groups)
    out = bytearray(_HEADER_LINE)
    out += _block(wb.FH_123)
    serial = 0  # global column counter: 147B header id + 519B property serial

    for short_book, _long, sheets in windows:
        for k, (ds, cols) in enumerate(sheets, start=1):
            suffix = f"@{k}" if k > 1 else ""
            # datasets section: [NULL][147B column header][data] per column
            arrays = [np.asarray(ds.time, dtype=float)] + [
                np.asarray(ds.values[:, j], dtype=float) for j in range(ds.values.shape[1])
            ]
            for (short, _lng, _unit, _desig, _cmt), arr in zip(cols, arrays, strict=True):
                serial += 1
                out += _NULL
                filled = np.flatnonzero(np.isfinite(arr))
                used_end = int(filled[-1]) + 1 if filled.size else 0  # one past the last value
                name = f"{short_book}_{short}{suffix}"
                out += _block(wb.col_header(name, len(arr), serial, used_end))
                out += _data_block(arr)

    out += _NULL * 2  # datasets / windows section separator

    # windows section: per book a window section; a WORKSHEET section is
    # followed by 6 NULLs before the next section (graph sections use 2 —
    # measured across every Moke window; with 2 the loader folds the next
    # book into the previous one: PW1 probe, books=1 -> 2). Inside one
    # window, a further sheet follows its predecessor's last label block
    # after 5 NULLs (the corpus' two-sheet books).
    serial = 0
    for w, (short_book, long_book, sheets) in enumerate(windows):
        if w:
            out += _NULL * 6
        out += _block(wb.window_header(short_book, long_book))
        for k, (ds, cols) in enumerate(sheets, start=1):
            if k > 1:
                out += _NULL * 5
            out += _block(wb.sheet_subheader(len(ds.time), f"Sheet{k}", k))
            out += wb.sheet_storage_group()
            out += _NULL  # closes the record-group run (real files: group NULL + one)
            serial = _sheet_properties(out, cols, serial)
    out += _NULL * 3  # closes the windows section (stream end)

    out += wb.tail(len(windows))
    struct.pack_into("<I", out, wb.fh_size_offset(_HEADER_LINE), len(out))
    return bytes(out)


def _sheet_properties(out: bytearray, cols: list[_Column], serial: int) -> int:
    """Append one sheet's property + label blocks; returns the last serial.

    A Y column is associated with its nearest-preceding X (column A first; a
    later X-designated column opens the next X group); an error / label / Z
    column with the nearest-preceding Y of that group (the corpus-measured
    @35 model, writer_blocks.prop_block), falling back to the X when no Y
    precedes it."""
    x_serial, x_group, y_serial = 0, 0, 0
    for short, long_name, unit, desig, comment in cols:
        serial += 1
        if desig == "X":
            x_serial, x_group, y_serial = serial, x_group + 1, 0
        assoc = x_serial if desig == "Y" else (y_serial or x_serial)
        if desig == "Y":
            y_serial = serial
        out += _block(wb.prop_block(serial, short, _DESIGNATION_CODE[desig], assoc, x_group))
        out += _label_block(long_name, unit, comment)
    return serial


def write_opj(books: list[DataStruct], path: Path) -> None:
    """Write ``books`` to ``path`` as an Origin ``.opj`` project."""
    Path(path).write_bytes(opj_bytes(books))
