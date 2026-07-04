"""Write Origin ``.opj`` (CPYA) projects from DataStructs (plan item 24).

Origin ≥ 2023 dropped *writing* ``.opj`` but still *reads* it, so one CPYA
writer reaches every Origin version — the "hand a file back to Origin
colleagues" path. The emitted container mirrors the reverse-engineered layout
(``docs/origin_project_format.md`` + ``docs/origin_re/opj_windows_section.md``):

* header line + file-header block,
* per column: a header block carrying the dataset name ``"<Book>_<Col>"`` and
  a data block of 10-byte ``<uint16 mask><float64>`` records (NaN → Origin's
  missing-value sentinel),
* a windows section per book: window-header block (short name @0x02, long
  name anchored by ``@${``), then per column a 519-byte property block
  (designation @0x11, short name @0x12) + a label block
  (``LongName\\r\\nUnit\\r\\nComment``).

Round-trip through :func:`quantized.io.origin_project.read_origin_books` is
CI-tested; opening the output in real Origin is validated manually during
trial windows (plan item 31) and has not been confirmed yet — the structural
fields Origin's own parser may additionally require are synthesized from the
documented offsets, not copied from any file.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["opj_bytes", "write_opj"]

_HEADER_LINE = b"CPYA 4.3380 188 W64 #\n"
_DESIGNATION_CODE = {"Y": 0, "disregard": 1, "Y-error": 2, "X": 3, "label": 4, "Z": 5, "X-error": 6}
_SHORTS = [chr(c) for c in range(ord("A"), ord("Z") + 1)]


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


_SPACER = struct.pack("<I", 0) + b"\n"


def _no_data_multiple(payload: bytes) -> bytes:
    """Pad so the block size is never a multiple of 10 (data-block ambiguity)."""
    return payload + b"\x00" if len(payload) % 10 == 0 else payload


def _column_header_block(dataset: str) -> bytes:
    payload = b"\x00" * 40 + dataset.encode("latin1") + b"\x00" + b"\x00" * 6
    return _block(_no_data_multiple(payload))


def _data_block(values: np.ndarray) -> bytes:
    vals = np.asarray(values, dtype="<f8").copy()
    vals[np.isnan(vals)] = ORIGIN_MISSING
    rows = np.zeros((len(vals), 10), dtype=np.uint8)
    rows[:, 2:] = vals.view(np.uint8).reshape(len(vals), 8)
    return _block(rows.tobytes())


def _window_header_block(book: str, long_name: str) -> bytes:
    payload = bytearray(b"\x00\x00" + book.encode("latin1") + b"\x00")
    payload += b"\x00" * (0xC0 - len(payload))
    if long_name and long_name != book:
        payload += long_name.encode("latin1") + b"@${[0|]}"
    payload += b"\x00" * max(0, 165 - len(payload))
    return _block(_no_data_multiple(bytes(payload)))


def _property_block(short: str, designation: str) -> bytes:
    p = bytearray(519)
    p[0x06] = 0x0B
    p[0x11] = _DESIGNATION_CODE.get(designation, 0)
    p[0x12 : 0x12 + len(short) + 1] = short.encode("latin1") + b"\x00"
    p[0x25] = 0x21
    return _block(bytes(p))


def _label_block(long_name: str, unit: str, comment: str) -> bytes:
    text = "\r\n".join([long_name, unit, comment]).rstrip("\r\n") or " "
    return _block(_no_data_multiple(text.encode("latin1", errors="replace") + b"\x00"))


def _book_name(ds: DataStruct, index: int, used: set[str]) -> tuple[str, str]:
    """(short, long) book names: short must be latin-1 word-ish and unique."""
    raw = str(ds.metadata.get("origin_book", "") or f"Book{index + 1}")
    short = "".join(c for c in raw if c.isalnum() or c == " ").strip() or f"Book{index + 1}"
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
    out += _block(b"\x00" * 123)  # file-header block
    used: set[str] = set()
    named: list[tuple[str, str, DataStruct, list[tuple[str, str, str, str]]]] = []

    for i, ds in enumerate(books):
        short_book, long_book = _book_name(ds, i, used)
        ncols = 1 + ds.values.shape[1]
        if ncols > len(_SHORTS):
            raise ValueError(f"book '{short_book}': {ncols} columns exceeds A..Z")
        cols: list[tuple[str, str, str, str]] = []  # (short, long, unit, designation)
        cols.append(
            (
                _SHORTS[0],
                str(ds.metadata.get("x_column_long", "") or ""),
                str(ds.metadata.get("x_unit", "") or ""),
                "X",
            )
        )
        for j in range(ds.values.shape[1]):
            label = ds.labels[j] if j < len(ds.labels) else ""
            unit = ds.units[j] if j < len(ds.units) else ""
            cols.append((_SHORTS[j + 1], str(label), str(unit), "Y"))
        named.append((short_book, long_book, ds, cols))

        # datasets section: [spacer][column header][data] per column
        arrays = [np.asarray(ds.time, dtype=float)] + [
            np.asarray(ds.values[:, j], dtype=float) for j in range(ds.values.shape[1])
        ]
        for (short, _lng, _unit, _desig), arr in zip(cols, arrays, strict=True):
            out += _SPACER
            out += _column_header_block(f"{short_book}_{short}")
            out += _data_block(arr)

    # windows section: worksheet window definitions carrying names/units
    for short_book, long_book, _ds, cols in named:
        out += _SPACER
        out += _window_header_block(short_book, long_book)
        for short, long_name, unit, desig in cols:
            out += _property_block(short, desig)
            out += _label_block(long_name, unit, "")
    return bytes(out)


def write_opj(books: list[DataStruct], path: Path) -> None:
    """Write ``books`` to ``path`` as an Origin ``.opj`` project."""
    Path(path).write_bytes(opj_bytes(books))
