"""Matrix-book geometry for CPYUA ``.opju`` projects.

A matrix object's cells are an ordinary dataset record (a bare book name, no
``_Col`` suffix — ``opju_records`` decodes it like any double / float32 /
integer / complex column) holding ``rows × cols`` values in row-major order.
The shape is NOT in that record: it lives in the matrix window's layer block
in the windows section, and the X/Y coordinate ranges in four small text
objects named ``X1``/``X2``/``Y1``/``Y2``. This module reads exactly those.

Clean-room, from byte evidence; the oracle is the third-party matrix test
projects and their published expectations (71×29 with ranges 5329..9999 /
731..999, 137×179 with 13..21 / 17..37, nine 2×3 matrices of every element
type, and a 3×5 matrix with ranges 1..3 / 1..5) — see
``docs/origin_project_format.md`` §3.6. Everything is located through
run-length blocks (``opju_blocks.rle_expand``) — here with a varint block
length, since a layer block's token stream exceeds 127 bytes:

* the **window block** — expands to ``00 00 <book name> 00 …``;
* the **layer block** that follows it — ``u16`` column count at ``0x2B`` and
  ``u16`` row count at ``0x52``. The product must equal the dataset's cell
  count, which is the validity gate: a block that does not multiply out is
  not this matrix's layer, and the matrix is then reported without a shape
  rather than given a guessed one;
* each **coordinate object** — a block with ``X1``/``X2``/``Y1``/``Y2`` at
  ``0x46``, followed by ``00`` and a block whose text is the number. All
  four oracle projects carry all four objects (the 3×5 one spells out its
  default 1..3 / 1..5), so nothing is assumed about a matrix that lacks
  one: unless all four parse, the ranges are reported as unknown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from quantized.io.origin_project.opju_blocks import rle_expand
from quantized.io.origin_project.opju_codec import CodecError, _read_varint

__all__ = ["MatrixGeometry", "matrix_geometry"]

_LEAD = re.compile(rb"\x80")
_COLS_OFF, _ROWS_OFF = 0x2B, 0x52
_COORD_NAME_OFF = 0x46
_LAYER_SEARCH = 4096  # the layer block sits within ~150 bytes of its window block
_COORD_SEARCH = 65536
_COORD_NAMES = (b"X1", b"X2", b"Y1", b"Y2")


@dataclass(frozen=True)
class MatrixGeometry:
    """Shape and coordinate ranges of one matrix object."""

    rows: int
    cols: int
    x_range: tuple[float, float] | None
    y_range: tuple[float, float] | None


def _block(b: bytes, s: int) -> tuple[bytes, int] | None:
    """Expand the run-length block whose ``0x80`` lead is at ``s``."""
    try:
        clen, q = _read_varint(b, s + 1)
    except CodecError:
        return None
    if not 0 < clen <= 4096:
        return None
    raw = rle_expand(b, q, clen)
    return None if raw is None else (raw, q + clen)


def _window_end(b: bytes, name: bytes, start: int) -> int | None:
    """Offset just past the window block of book ``name`` (first at/after
    ``start``), or None."""
    head = b"\x00\x00" + name + b"\x00"
    for m in _LEAD.finditer(b, start):
        got = _block(b, m.start())
        if got is not None and got[0].startswith(head):
            return got[1]
    return None


def _coordinate(b: bytes, end: int) -> float | None:
    """The number in the text block that follows a coordinate object."""
    if b[end : end + 2] != b"\x00\x80":
        return None
    got = _block(b, end + 1)
    if got is None:
        return None
    text = got[0].split(b"\x00", 1)[0]
    try:
        return float(text.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        return None


def matrix_geometry(
    b: bytes, name: str, cells: int, *, start: int = 0, other_books: tuple[str, ...] = ()
) -> MatrixGeometry | None:
    """Shape + ranges of matrix book ``name`` (``cells`` values), or None when
    no layer block multiplies out to ``cells``.

    ``start`` bounds the search to the windows section (pass the end of the
    last dataset record); ``other_books`` are the project's other book names,
    whose window blocks end this matrix's coordinate search so a neighbour's
    ranges are never borrowed.
    """
    win_end = _window_end(b, name.encode("latin1"), start)
    if win_end is None:
        return None
    rows = cols = 0
    layer_end = 0
    for m in _LEAD.finditer(b, win_end, min(len(b), win_end + _LAYER_SEARCH)):
        got = _block(b, m.start())
        if got is None or len(got[0]) < _ROWS_OFF + 2:
            continue
        raw = got[0]
        c = int.from_bytes(raw[_COLS_OFF : _COLS_OFF + 2], "little")
        r = int.from_bytes(raw[_ROWS_OFF : _ROWS_OFF + 2], "little")
        if c and r and c * r == cells:
            rows, cols, layer_end = r, c, got[1]
        break  # the FIRST block that long is the layer block, match or not
    if not rows:
        return None

    stop = min(len(b), layer_end + _COORD_SEARCH)
    heads = [b"\x00\x00" + o.encode("latin1") + b"\x00" for o in other_books if o != name]
    found: dict[bytes, float | None] = {}
    for m in _LEAD.finditer(b, layer_end, stop):
        got = _block(b, m.start())
        if got is None:
            continue
        raw, end = got
        if any(raw.startswith(h) for h in heads):
            break  # the next book's window: this matrix's objects are behind us
        tag = raw[_COORD_NAME_OFF : _COORD_NAME_OFF + 3]
        if len(tag) == 3 and tag[2] == 0 and tag[:2] in _COORD_NAMES and tag[:2] not in found:
            found[tag[:2]] = _coordinate(b, end)
    values = [found.get(k) for k in _COORD_NAMES]
    if any(v is None for v in values):
        return MatrixGeometry(rows, cols, None, None)
    x1, x2, y1, y2 = (float(v) for v in values if v is not None)
    return MatrixGeometry(rows, cols, (x1, x2), (y1, y2))
