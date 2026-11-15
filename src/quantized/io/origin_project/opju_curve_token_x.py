"""The X column a ``.opju`` curve token stores for itself.

A curve token is the sparse serialization of the 519-byte curve-anchor
record (``curve_style_color`` module docstring: ``<tag 80-bf> <len>`` skips
``tag-0x80+3`` zero bytes then writes ``len`` literals, ``c0-c3 <rep>`` writes
a run, ``01-7f`` is a bare literal run; the token's ``80 01|03 <id>`` chunk
writes the Y column id at record offset 4). The record ALSO names the
plot's X: offsets 35-36 hold the X column's global id (u16 LE) and offsets
37-38 a designation pair ``21 61`` (or ``21 21``) -- the same ``<x id> 21 61``
shape a Y column record uses for its designated X partner
(``opju_figure_curves._parse_column_record``).

Before this decode the curve's X was the Y column's designated partner, so a
plot drawn against any other column was drawn against the wrong X. Measured
against Origin 2026b COM (``%(iX,@D)`` per plot, 2026-11-15):

* ``Figure4.opju`` Graph1: Y ``Book1_C/E/F/H`` (partner ``A``), record X id 2
  = ``Book1_B``, Origin's X ``Book1_B``;
* ``Sample_OriginPro_ResonatorData.opju`` RawAndFit layer 2: Y ``S2136_M/N``
  record X 43 = ``K``, ``O/P`` record X 44 = ``L`` -- Origin's ``S2136_K`` /
  ``S2136_L``;
* ``SOP_meas.opju`` Graph73: record X 2365 = ``A@5``, Origin's
  ``SOPvsHPPCA123_A@5``;
* ``Hc2 data.opju`` lockin graphs: record X ``AE``/``AC``/``R``, never the
  designated ``A`` (which the importer does not even hold for those books);
  ``EIS.opju`` Graph1 (pair ``21 21``): record X ``E``, Origin's ``Book1_E``.

Corpus-wide (359 files) the record X changes 298 drawn curves' X and omits
255; every one of the 22 affected files was checked against Origin per curve
(Y values plus a paired (x, y) row fingerprint): 0 curves drawn wrong.

**X id 0** = the plot has no X column. ``SOP_meas`` Graph72 (Origin: ``Row
Numbers``) and Graph16 / Graph41 layer 6 (Origin reports no X dataset at
all; their axis spans are a binned distribution, not a column) both carry
it. quantized has no row-number or binned-X binding, so such a curve is
omitted (``x_not_a_column``), never drawn against a column.

Fail closed: :func:`token_x_id` returns ``None`` unless the walk writes
offsets 35-38 (literal or elided-zero bytes) and they end in a known pair;
the caller then
keeps the designated-partner X it used before (no regression).
"""

from __future__ import annotations

from collections.abc import Mapping

__all__ = ["X_FIELD", "token_x", "token_x_id"]

X_FIELD = 35  # record offset of the X column id (u16 LE); marker at +2
# The pair at offsets 37-38 that validates the field: ``21 61`` on most
# tokens, ``21 21`` on some (EIS, Hc2 data); both COM-checked. ``30 61``
# (Y-error tokens) and any other pair are not decoded.
_MARKERS = (b"\x21\x61", b"\x21\x21")
_END = X_FIELD + 4  # the walk only needs to reach past the marker


def token_x_id(b: bytes, tag_pos: int) -> int | None:
    """The X column id the curve record at ``tag_pos`` (its ``80 01|03 <id>``
    chunk) stores, ``0`` for "no X column", or ``None`` when the record's X
    field is not literally present (zero-skipped, truncated, or no marker)."""
    lit = bytearray(_END)
    have = [False] * _END
    pos = 1  # the id chunk's skip starts after the record's offset-0 byte
    p = tag_pos
    n = len(b)

    def put(at: int, data: bytes) -> None:
        for k, v in enumerate(data):
            if 0 <= at + k < _END:
                lit[at + k] = v
                have[at + k] = True

    while p < n and pos < _END:
        t = b[p]
        if 0x80 <= t <= 0xBF:
            if p + 2 > n or p + 2 + b[p + 1] > n:
                return None
            ln = b[p + 1]
            skip = (t - 0x80) + 3
            put(pos, bytes(skip))  # an elided zero run is a written zero
            pos += skip
            put(pos, b[p + 2 : p + 2 + ln])
            pos += ln
            p += 2 + ln
        elif 0xC0 <= t <= 0xC3:
            if p + 2 > n:
                return None
            run = (t - 0xC0) + 3
            put(pos, bytes([b[p + 1]]) * run)
            pos += run
            p += 2
        elif 0 < t < 0x80:
            if p + 1 + t > n:
                return None
            put(pos, b[p + 1 : p + 1 + t])
            pos += t
            p += 1 + t
        else:
            return None
    if pos < _END or not all(have[X_FIELD:_END]) or bytes(lit[X_FIELD + 2 : _END]) not in _MARKERS:
        return None
    return int.from_bytes(lit[X_FIELD : X_FIELD + 2], "little")


def token_x(
    b: bytes,
    tag_pos: int,
    book: str,
    partner: int | None,
    ids: Mapping[int, tuple[str, str]],
) -> tuple[int | None, str]:
    """``(X column id to bind, omit reason)`` for the curve token at ``tag_pos``
    plotting a column of ``book`` whose designated X partner is ``partner``.

    The record's own X wins when it is decodable. Fail closed when it names
    no column (``x_not_a_column``: row numbers / binned X), a column the id
    table does not hold (``x_column_unknown``: the importer cannot look it
    up, and the designated partner is provably NOT what Origin plots), or a
    column of another book (``x_other_book``: the binding names one book).
    An undecodable X field keeps ``partner`` -- the binding shipped before.
    """
    tx = token_x_id(b, tag_pos)
    if tx is None or tx == partner:
        return partner, ""
    if tx == 0:
        return partner, "x_not_a_column"
    info = ids.get(tx)
    if info is None:
        return partner, "x_column_unknown"
    if info[0] != book:
        return partner, "x_other_book"
    return tx, ""
