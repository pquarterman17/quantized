"""``.opju`` column ids whose low byte is zero (256, 512, 768, ...).

A column id is written into two CPYUA sparse records: the column's own
record (``opju_figure_curves``' id table) and every curve token that plots
it. Both records use the zero-eliding chunk grammar of
``curve_style_color``: ``<tag 0x80+k> <len> <payload>`` skips ``k + 3`` zero
bytes, then writes ``len`` literal bytes. The id sits at record offset 4
(u16 LE), right after the 3 zero bytes a ``80`` tag skips, so an id is
normally written ``80 03 <lo> <hi> <next>`` (or ``80 01 <id>`` when the
high byte and the next byte are zero too). When the LOW byte is zero the
writer folds it into the skip instead: ``81 02 <hi> <next>`` -- one more
skipped zero (offset 4), then the high byte at offset 5.

The id-table and token readers matched only the ``80`` forms, so every
column whose id is a multiple of 256 was missing from the id table and
every curve plotting one was never decoded. A missing id breaks the sheet
rank alignment for its whole ``(book, column)`` name (``opju_curve_sheets``:
26 ids against 27 ``Book1D_D[@N]`` datasets proves no sheet for any of
them), and an X partner that is missing turns its curves'
``opju_curve_token_x`` X into ``x_column_unknown``.

Corpus (359 ``.opju``, 2026-11-15): 107 column records in the ``81 02``
form pass the same field walk and designation-marker check as the other
forms (``_parse_column_record``), none on an id another form already
claims; no ``01 10 81 01`` record parses. Tokens use both ``81 02 <hi>
<next>`` and, when ``<next>`` is zero too, ``81 01 <hi>``. Evidence
(Origin 2026b COM, 2026-11-15, ``ORIGIN_FILE_DECODE_PLAN`` items 67-68):
every curve this and signal S newly draw was compared with the datasets
Origin plots (``%(i,@D)`` / ``%(iX,@D)`` values and a paired (x, y)
fingerprint), 0 drawn differently.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

__all__ = [
    "CURVE_TOKEN",
    "ID_FORM_ZERO_LOW",
    "curve_token_id",
    "curve_token_starts",
    "zero_low_id",
    "zero_low_id_chunk",
]

# Column record, zero low byte: 01 10 81 02 <hi> <pb> <fields...>; the
# match ends where form A's does (before <pb>), so the same parser applies.
ID_FORM_ZERO_LOW = re.compile(rb"\x01\x10\x81\x02(.)", re.DOTALL)

# The unified curve token, every id width: <flag> 01 01 01 then
# 80 01 <id:u8> | 80 03 <id:u16 LE> <x> | 81 02 <hi> <x> | 81 01 <hi>
# (the last two: id = hi << 8; ``81 01`` when <x> is zero too).
CURVE_TOKEN = re.compile(rb"\x01\x01\x01(?:\x80([\x01\x03])|\x81[\x01\x02])", re.DOTALL)


def zero_low_id_chunk(b: bytes, p: int) -> tuple[int, int] | None:
    """Decode the zero-low-byte id chunk at ``p`` (its ``81`` tag):
    ``(column id, bytes consumed)`` for ``81 02 <hi> <next>`` (4 bytes) or
    ``81 01 <hi>`` (3 bytes: the next byte is zero too), the id being
    ``hi << 8``; ``None`` when ``p`` holds no such chunk (another id form,
    or the stream ends inside it)."""
    if p + 2 > len(b) or b[p] != 0x81 or b[p + 1] not in (1, 2):
        return None
    size = 2 + b[p + 1]
    if p + size > len(b):
        return None
    return b[p + 2] << 8, size


def zero_low_id(m: re.Match[bytes]) -> int:
    """The column id an ``ID_FORM_ZERO_LOW`` match carries."""
    return m.group(1)[0] << 8


def curve_token_id(b: bytes, m: re.Match[bytes]) -> int | None:
    """The column id a ``CURVE_TOKEN`` match names, ``None`` when the
    stream ends inside the id."""
    if m.group(1) is None:  # 81 0[12] <hi> ...: the chunk starts 3 bytes in
        got = zero_low_id_chunk(b, m.start() + 3)
        return got[0] if got is not None else None
    at = m.end()
    width = m.group(1)[0]
    if at + width > len(b):
        return None
    if width == 1:
        return b[at]
    return int.from_bytes(b[at : at + 2], "little")


def curve_token_starts(b: bytes, start: int, end: int) -> Iterator[int]:
    """Start offsets of every ``CURVE_TOKEN`` in ``b[start:end)``."""
    return (m.start() for m in CURVE_TOKEN.finditer(b, start, end))
