"""The ``.opju`` column-id chunk: ONE decoder for every form it is written in.

A column id is written into two CPYUA sparse records: the column's own
id record (``opju_figure_curves``' id table) and every curve token that
plots it. Both use the zero-eliding chunk grammar of ``curve_style_color``:
``<tag 0x80+k> <len> <len literals>`` skips ``k + 3`` zero bytes, then
writes ``len`` literal bytes. The id sits at record offset 4 (u16 LE),
right after the 3 zero bytes a ``0x80`` tag skips, and ``len`` is just how
many literal bytes the writer happened to emit from there -- it is NOT a
field width:

* ``80 01 <id:u8>`` -- id < 256 and the next byte zero (elided);
* ``80 02 <id:u16>`` -- the flag byte after the id is zero;
* ``80 03 <id:u16> <flag>`` -- the common case;
* ``80 04+ <id:u16> <flag> ...`` -- the run continues into the next
  fields (in a curve token, a non-zero first plotted row:
  ``opju_curve_range``; in a column record, Discretewithsum ``Mid1_I`` /
  ``Mid2_I`` write ``80 04 <id> <pb> 0c``);
* ``81 <len> <hi> ...`` -- the id's LOW byte is zero, so the writer folds
  it into the skip (``0x81`` skips 4 zeros) and the first literal is the
  high byte: id = ``hi << 8`` (``81 02 <hi> <next>``, or ``81 01 <hi>``
  when the next byte is zero too). Before this was read every column whose
  id is a multiple of 256 was missing (it broke the sheet rank alignment
  of its whole ``(book, column)`` name: 26 ids against 27 ``Book1D_D[@N]``
  datasets).

Before the generalization only ``80 01`` / ``80 03`` (then also ``81 01``
/ ``81 02``) were read, so every plot whose token was written with another
length was silently missing (``ORIGIN_FILE_DECODE_PLAN`` items 67-68).
Corpus census (359 ``.opju`` files, graph-page tokens after the ``01 01 01``
lead): ``80`` lengths 1: 1,125, 2: 875, 3: 11,250, 4: 15, 5: 1, 9: 26,
10: 12; the ids of 850 length-2 and 13 length-4 chunks name a column in
the id table, at the same rate as length 3; 107 column records use the
``81 02`` form. Origin 2026b COM evidence: the plan's Completed entries for
#67/#68 (``%(i,@D)`` / ``%(iX,@D)`` values + a paired (x, y) fingerprint
on every layer whose curves change).
"""

from __future__ import annotations

import re

__all__ = [
    "CURVE_TOKEN",
    "ID_FORM_B",
    "ID_FORM_B1",
    "chunk_id",
    "column_id_records",
    "is_shipped_form",
    "token_id",
]

# <flag> 01 01 01 then the id chunk <80|81> <len>.
CURVE_TOKEN = re.compile(rb"\x01\x01\x01([\x80\x81])([\x01-\x0f])", re.DOTALL)
# A column's own id record: 01 10 (offset 0) then the same id chunk.
_COLUMN_ID_A = re.compile(rb"\x01\x10([\x80\x81])([\x01-\x0f])", re.DOTALL)
# Form B: a 7-byte (u16 id + <pb>) or 5-byte (u8 id) literal run.
ID_FORM_B = re.compile(rb"\x07\x10\x01\x00\x00(..)", re.DOTALL)
ID_FORM_B1 = re.compile(rb"\x05\x10\x01\x00\x00(.)", re.DOTALL)

# The forms read before the generalization: their curves (and the dedup
# winner among them) are what shipped, so they stay authoritative.
_SHIPPED = {(0x80, 1), (0x80, 3), (0x81, 1), (0x81, 2)}


def chunk_id(b: bytes, p: int) -> tuple[int, int] | None:
    """Decode the id chunk whose tag is at ``p``: ``(column id, offset just
    past the chunk)``, or None when ``p`` holds no id chunk or the stream
    ends inside it."""
    if p + 2 > len(b) or b[p] not in (0x80, 0x81) or not 1 <= b[p + 1] <= 0x0F:
        return None
    tag, n, q = b[p], b[p + 1], p + 2
    if q + n > len(b):
        return None
    if tag == 0x81:
        return b[q] << 8, q + n
    if n == 1:
        return b[q], q + n
    return int.from_bytes(b[q : q + 2], "little"), q + n


def token_id(b: bytes, m: re.Match[bytes]) -> int | None:
    """The column id a :data:`CURVE_TOKEN` match names (None: truncated)."""
    got = chunk_id(b, m.start(1))
    return got[0] if got is not None else None


def is_shipped_form(m: re.Match[bytes]) -> bool:
    """Whether a :data:`CURVE_TOKEN` match is one of the id-chunk forms read
    before every length was (``80 01|03``, ``81 01|02``)."""
    return (m.group(1)[0], m.group(2)[0]) in _SHIPPED


def column_id_records(b: bytes, start: int, end: int) -> list[tuple[int, int, int]]:
    """Every column id record in ``b[start:end)`` as ``(record offset, id,
    offset of its tagged fields)``, in the shipped scan order (form A
    ``80 03``, B, A ``80 01``, B1, A ``81``), the other chunk lengths last."""
    groups: dict[str, list[tuple[int, int, int]]] = {"a3": [], "a1": [], "z": [], "rest": []}
    for m in _COLUMN_ID_A.finditer(b, start, end):
        got = chunk_id(b, m.start(1))
        if got is None:
            continue
        form = (m.group(1)[0], m.group(2)[0])
        key = {(0x80, 3): "a3", (0x80, 1): "a1"}.get(form, "z" if form[0] == 0x81 else "rest")
        groups[key].append((m.start(), got[0], got[1]))
    forms_b = [
        (m.start(), int.from_bytes(m.group(1), "little"), m.end() + 1)  # one <pb>
        for m in ID_FORM_B.finditer(b, start, end)
    ]
    forms_b1 = [(m.start(), m.group(1)[0], m.end()) for m in ID_FORM_B1.finditer(b, start, end)]
    return [*groups["a3"], *forms_b, *groups["a1"], *forms_b1, *groups["z"], *groups["rest"]]
