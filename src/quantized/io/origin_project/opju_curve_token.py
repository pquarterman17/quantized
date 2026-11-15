"""The ``.opju`` curve token's id chunk, at every literal width.

A curve token is the sparse serialization of the 519-byte curve-anchor
record (``curve_style_color``): ``<tag 80-bf> <len> <len literals>`` skips
``tag-0x80+3`` zero bytes and then writes ``len`` bytes. The token's id
chunk is ``80 <len>`` at record offset 4, so ``len`` is just how many
literal bytes the writer happened to emit there, NOT a field width:

* ``80 01 <id:u8>`` -- the id is < 256 and offset 5 is zero (elided);
* ``80 02 <id:u16>`` -- offset 6 (the flag byte) is zero;
* ``80 03 <id:u16> <flag>`` -- the common case;
* ``80 04+ <id:u16> <flag> ...`` -- the literal run continues into the
  record's next fields.

Before this module only lengths 1 and 3 were read, so every plot whose
token happened to be written with length 2 or >= 4 was silently missing
(``ORIGIN_FILE_DECODE_PLAN`` item 68). Corpus census (359 ``.opju`` files,
chunks after the ``01 01 01`` lead in graph pages): length 1: 1,125,
2: 875, 3: 11,250, 4: 15, 5: 1, 9: 26, 10: 12 -- the id of 850 of the
length-2 and 13 of the length-4 chunks names a column in the id table, at
the same rate as length 3. Origin 2026b COM (``%Z`` + per-plot values, see
the plan's Completed entry) confirms the curves they bind.
"""

from __future__ import annotations

import re

__all__ = ["CURVE_TOKEN", "column_id_chunks", "token_id"]

# <flag> 01 01 01 then the id chunk 80 <len>; the lead the shipped reader
# anchored on, with any literal length the record grammar allows here.
CURVE_TOKEN = re.compile(rb"\x01\x01\x01\x80([\x01-\x0f])", re.DOTALL)


def token_id(b: bytes, m: re.Match[bytes]) -> int | None:
    """The column id a :data:`CURVE_TOKEN` match writes at record offset 4
    (u8 for a 1-byte chunk, else u16 LE), or None when it runs off ``b``."""
    width = m.group(1)[0]
    p = m.end()
    if width == 1:
        return b[p] if p < len(b) else None
    if p + 2 > len(b):
        return None
    return int.from_bytes(b[p : p + 2], "little")


# The worksheet column's own id record (``opju_figure_curves`` form A) is the
# same sparse grammar: ``01 10`` writes offset 0, then the id chunk ``80
# <len>`` -- ``01 10 80 03 <id:u16> <pb>`` and the u8 form ``01 10 80 01
# <id>`` are lengths 3 and 1; Discretewithsum's ``Mid1_I`` / ``Mid2_I``
# records are ``80 04 <id:u16> <pb> 0c`` (the run continues one byte).
_COLUMN_ID_A = re.compile(rb"\x01\x10\x80([\x01-\x0f])", re.DOTALL)


def column_id_chunks(b: bytes, start: int, end: int) -> list[tuple[int, int, int]]:
    """Every form-A column id record in ``b[start:end)`` as ``(id, offset
    just past the id chunk, chunk length)`` -- the offset is where the
    record's tagged fields begin."""
    out: list[tuple[int, int, int]] = []
    for m in _COLUMN_ID_A.finditer(b, start, end):
        width = m.group(1)[0]
        p = m.end()
        if p + width > len(b):
            continue
        cid = b[p] if width == 1 else int.from_bytes(b[p : p + 2], "little")
        out.append((cid, p + width, width))
    return out
