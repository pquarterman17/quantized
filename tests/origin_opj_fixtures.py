"""Synthetic CPYA ``.opj`` byte fixtures that model the REAL block layouts.

Everything here is constructed, never copied from a specimen: zeroed blocks
with only the fields the reader acts on filled in, at the offsets
``docs/origin_project_format.md`` §3.1 / §3.1.1 / §4.1 document.

Stream grammar modelled::

    "CPYA 4.3380 188 W64 #\\n"
    [file-header block] [NULL]
    ([dataset header] [data block | NULL] [NULL])*      datasets section
    [NULL]
    ([window header] [sheet sub-header] ... )*           windows section

Dataset header (``dataset_header``): type flags at 0x16, kind flags at
0x17, u32 allocated / first-used / used-end rows at 0x19 / 0x1D / 0x21,
bytes-per-row at 0x3D, unsigned flag (0x08) at 0x3F, NUL-terminated name at
0x58. The block SIZE is the version marker (115 / 123 / 140 / 147 bytes);
the offsets do not move.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence

HEADER_LINE = b"CPYA 4.3380 188 W64 #\n"

# (type flags @0x16, kind flags @0x17, bytes per row) per column kind, as
# real files carry them for a Y-designated column.
DOUBLE = (0x01, 0x60, 8)
FLOAT = (0x03, 0x60, 4)
INT16 = (0x03, 0x68, 2)
INT32 = (0x01, 0x68, 4)
INT8 = (0x21, 0x68, 1)
COMPLEX = (0x01, 0x62, 16)
TEXT_NUMERIC = (0x21, 0x61, 10)
TEXT = (0x21, 0x60, 50)

MISSING = b"\x0e\x2c\x13\x1c\xfe\x74\xaa\x81"  # Origin's blank-cell double


def block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def null() -> bytes:
    return struct.pack("<I", 0) + b"\n"


def dataset_header(
    name: str,
    kind: tuple[int, int, int],
    *,
    total: int,
    used: int,
    first: int = 0,
    unsigned: bool = False,
    size: int = 147,
    elem: int | None = None,
) -> bytes:
    p = bytearray(size)
    p[0x16], p[0x17] = kind[0], kind[1]
    struct.pack_into("<III", p, 0x19, total, first, used)
    p[0x3D] = kind[2] if elem is None else elem
    p[0x3F] = 0x08 if unsigned else 0x00
    raw = name.encode("latin1") + b"\x00"
    p[0x58 : 0x58 + len(raw)] = raw
    return bytes(p)


def tn_number(value: float) -> bytes:
    """A Text & Numeric cell holding a number: tag 0 + float64."""
    return b"\x00\x00" + struct.pack("<d", value)


def tn_text(text: str, width: int = 10) -> bytes:
    """A Text & Numeric cell holding text: tag 1 + NUL-terminated string.
    ``tn_text("")`` is a blank cell (one of the two blank encodings; the
    usual one from CPYA 4.3380 on)."""
    raw = text.encode("latin1")
    assert len(raw) < width - 2
    return b"\x01\x00" + raw + b"\x00" * (width - 2 - len(raw))


def tn_blank_old() -> bytes:
    """The other blank Text & Numeric cell: tag 0 + the missing-value
    double (the usual one up to CPYA 4.3295; both occur in every era)."""
    return b"\x00\x00" + MISSING


def text_cell(text: str, width: int = 50) -> bytes:
    raw = text.encode("latin1")
    return raw + b"\x00" * (width - len(raw))


def dataset(header: bytes, data: bytes | None) -> bytes:
    """One datasets-section entry; ``data=None`` is the empty-dataset slot."""
    return block(header) + (null() if data is None else block(data)) + null()


def project(datasets: Sequence[bytes], windows: bytes = b"") -> bytes:
    return (
        HEADER_LINE
        + block(b"\x02" + b"\x00" * 122)
        + null()
        + b"".join(datasets)
        + null()
        + windows
    )


def window_header(short: str, label: str = "", *, storage: bytes = b"") -> bytes:
    """A window header: ``00 00 <short> 00``, the fixed-region length (0xC3)
    at 0x6F, two float64 timestamps at 0x73 / 0x7B (whose tail bytes
    ``42 41`` are printable — the old reader's spurious "BA" title), then
    the label from 0xC3."""
    p = bytearray(0xC3)
    p[2 : 2 + len(short) + 1] = short.encode("latin1") + b"\x00"
    p[0x6F] = 0xC3
    struct.pack_into("<dd", p, 0x73, 2459000.5, 2459001.25)
    return block(bytes(p) + label.encode("latin1") + storage + b"\x00")


def sheet_header(
    name: str, *, matrix: bool = False, cols: int = 0, rows: int = 0, size: int = 365
) -> bytes:
    """A sheet sub-header: byte 2 = 0x5E worksheet / 0xDE matrix, u16
    columns at 0x2B, u32 rows at 0x52, ``Pd<Name>`` at 0xD0."""
    p = bytearray(size)
    p[2] = 0xDE if matrix else 0x5E
    struct.pack_into("<H", p, 0x2B, cols)
    struct.pack_into("<I", p, 0x52, rows)
    raw = b"Pd" + name.encode("latin1") + b"\x00"
    p[0xD0 : 0xD0 + len(raw)] = raw
    return block(bytes(p))


def prop_block(
    short: str, designation: int, kind: tuple[int, int, int] = TEXT_NUMERIC, *, size: int = 519
) -> bytes:
    """A column-property block: flag byte at 0x06, designation at 0x11,
    short name at 0x12, the column's two type bytes at 0x25-0x26."""
    p = bytearray(size)
    p[0x06] = 0x09
    p[0x11] = designation
    p[0x12 : 0x12 + len(short) + 1] = short.encode("latin1") + b"\x00"
    p[0x25], p[0x26] = kind[0], kind[1]
    return block(bytes(p))


def label_block(long_name: str = "", unit: str = "", comment: str = "") -> bytes:
    text = (
        "\r\n".join([long_name, unit, *comment.split("\n")])
        if comment
        else f"{long_name}\r\n{unit}"
    )
    return block(text.encode("latin1") + b"\x00")


def coordinate(name: str, value: str) -> bytes:
    """A matrix coordinate record (X1/X2/Y1/Y2): the name at 0x46 of a
    133-byte record, then a block holding the number as text."""
    p = bytearray(133)
    p[0x46 : 0x46 + 3] = name.encode("ascii") + b"\x00"
    return block(bytes(p)) + block(value.encode("ascii") + b"\x00") + null() + null()
