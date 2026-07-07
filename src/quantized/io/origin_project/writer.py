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
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project import writer_blocks as wb
from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["opj_bytes", "write_opj"]

_HEADER_LINE = b"CPYA 4.3380 188 W64 #\n"
_DESIGNATION_CODE = {"Y": 0, "disregard": 1, "Y-error": 2, "X": 3, "label": 4, "Z": 5, "X-error": 6}
_NULL = struct.pack("<I", 0) + b"\n"


def _col_short(i: int) -> str:
    """0-based column index -> Origin short name, bijective base-26
    (A..Z, AA, AB, …) — the same lettering the readers decode. (The old
    A..Z-only table made the writer reject >26-column books that the read
    path handles fine; 2026-07-06 genericity audit.)"""
    out = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _data_block(values: np.ndarray) -> bytes:
    vals = np.asarray(values, dtype="<f8").copy()
    vals[np.isnan(vals)] = ORIGIN_MISSING
    rows = np.zeros((len(vals), 10), dtype=np.uint8)
    rows[:, 2:] = vals.view(np.uint8).reshape(len(vals), 8)
    return _block(rows.tobytes())


def _label_block(long_name: str, unit: str, comment: str) -> bytes:
    text = "\r\n".join([long_name, unit, comment]).rstrip("\r\n") or " "
    return _block(text.encode("latin1", errors="replace") + b"\x00")


def _book_name(ds: DataStruct, index: int, used: set[str]) -> tuple[str, str]:
    """(short, long) book names: short must be latin-1 word-ish and unique."""
    raw = str(ds.metadata.get("origin_book", "") or f"Book{index + 1}")
    # LabTalk/dataset names must stay ASCII word characters (the reader's
    # NAME_RE contract): strip everything else, including non-Latin scripts.
    short = "".join(c for c in raw if c.isascii() and (c.isalnum() or c == " ")).strip()
    short = short or f"Book{index + 1}"
    base = short
    n = 1
    while short in used:
        n += 1
        short = f"{base}{n}"
    used.add(short)
    long_name = str(ds.metadata.get("origin_book_long", "") or short)
    return short, long_name


def opj_bytes(books: list[DataStruct]) -> bytes:
    """Serialize DataStructs as a CPYA ``.opj`` project (one workbook each).

    Column 0 of every book is the DataStruct's ``time`` (designation X, named
    by ``x_column_long``/``x_unit`` metadata when present); the value columns
    follow with their labels/units. Short designations run A, B, C, …
    """
    if not books:
        raise ValueError("opj_bytes needs at least one DataStruct")
    out = bytearray(_HEADER_LINE)
    out += _block(wb.FH_123)
    used: set[str] = set()
    named: list[tuple[str, str, DataStruct, list[tuple[str, str, str, str]]]] = []
    serial = 0  # global column counter: 147B header id + 519B property serial

    for i, ds in enumerate(books):
        short_book, long_book = _book_name(ds, i, used)
        cols: list[tuple[str, str, str, str]] = []  # (short, long, unit, designation)
        cols.append(
            (
                _col_short(0),
                str(ds.metadata.get("x_column_long", "") or ""),
                str(ds.metadata.get("x_unit", "") or ""),
                "X",
            )
        )
        for j in range(ds.values.shape[1]):
            label = ds.labels[j] if j < len(ds.labels) else ""
            unit = ds.units[j] if j < len(ds.units) else ""
            cols.append((_col_short(j + 1), str(label), str(unit), "Y"))
        named.append((short_book, long_book, ds, cols))

        # datasets section: [NULL][147B column header][data] per column
        arrays = [np.asarray(ds.time, dtype=float)] + [
            np.asarray(ds.values[:, j], dtype=float) for j in range(ds.values.shape[1])
        ]
        for (short, _lng, _unit, _desig), arr in zip(cols, arrays, strict=True):
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
        x_serial = serial + 1  # the book's X column (column A) comes first
        for short, long_name, unit, desig in cols:
            serial += 1
            out += _block(
                wb.prop_block(serial, short, _DESIGNATION_CODE.get(desig, 0), x_serial)
            )
            out += _label_block(long_name, unit, "")
    out += _NULL * 3  # closes the windows section (stream end)

    out += wb.tail(len(named))
    struct.pack_into("<I", out, wb.fh_size_offset(_HEADER_LINE), len(out))
    return bytes(out)


def write_opj(books: list[DataStruct], path: Path) -> None:
    """Write ``books`` to ``path`` as an Origin ``.opj`` project."""
    Path(path).write_bytes(opj_bytes(books))
