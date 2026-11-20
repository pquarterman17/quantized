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

**Offset 38 bit 0x40 = the plot is SHOWN** (2026-11-20). A plot hidden in
Origin's graph (Layer Contents / Plot Details "Show" off) stores ``21`` at
offset 38 where a shown plot stores ``61``: the pair reads ``21 21`` (or
``30 21`` on a Y-error plot). :func:`token_hidden` reads it. The evidence
(``docs/origin_re/curve_visibility.md``):

* controlled specimen -- ``hc2convert.opj`` is an earlier Origin save of the
  same ``Hc2 data`` project: its Graph3/7/9/15/22 plot the raw lockin columns
  ``E/G/I`` (``C/E/G``), drawn in Origin's own exported PNGs. In ``Hc2
  data.opju`` the user added the normalized ``R/RN`` columns and hid the raw
  ones. The 15 records of those raw plots are byte-identical across the two
  saves except offset 0 (the container's record-start byte, every record) and
  offset 38: ``61`` -> ``21``. The 86 other records both saves share (all
  still shown) differ at offset 38 in 0 cases;
* Origin-rendered oracle -- the embedded page preview Origin saves with each
  ``.opju`` graph draws exactly the ``61`` plots on every page read
  decisively (Hc2's six lockin graphs and Graph36; public EIS, UV-vis Tauc,
  拟合, Figure_12, Figure_15, PALS, Fig3_e; pedotpss Graph7 re-plotted from
  its data): 0 ``21`` plot drawn, 0 ``61`` plot missing;
* distribution -- 253 of the 11,917 corpus records that walk to offset 38
  read ``21``; the 228 that reconstruct fully span every plot style (line
  143, scatter 57, line+symbol 3, 203-style 20, error bar 5) and connect
  byte, so the bit does not track style, book or connect mode; 0 of
  the 428 records of the COM-built specimens (all plots shown) and 0 of the
  83 records of the COM-verified RockingCurve / UnpolPlots / Fixed Lambdas
  SI / XAS projects.

Origin's COM ``layer.plot`` enumeration lists a hidden plot like any other
(item 70's ``%(i,@D)`` sweep reported Hc2's raw lockin plots), so a COM plot
list is not a visibility oracle.
"""

from __future__ import annotations

from collections.abc import Mapping

__all__ = ["HIDDEN_IN_ORIGIN", "X_FIELD", "token_hidden", "token_x", "token_x_id"]

X_FIELD = 35  # record offset of the X column id (u16 LE); marker at +2
# The pair at offsets 37-38 that validates the field: ``21 61`` on most
# tokens, ``21 21`` on some (EIS, Hc2 data); both COM-checked. ``30 61``
# (Y-error tokens) and any other pair are not decoded. The pair is the plotted
# column's own designation flags (``opju_column_fixed``: offset 37 bit 0x20
# and offset 38 bit 0x01 are Text & Numeric format flags), so it is compared
# with those two bits masked off: ``01 60`` / ``01 20`` are the same pairs for
# a Numeric column (every plot-corpus specimen, Origin 2026b COM-built) and
# ``21 50`` / ``01 50`` an X-designated column plotted as a Y (CompareRc
# Graph2: Origin plots ``Book1_A`` against ``Book1_B``). COM-checked on the
# real files of ORIGIN_PLOT_TYPE_PARITY_PLAN items 5-7.
_MARKERS = ((0x01, 0x60), (0x01, 0x20), (0x01, 0x50))
_END = X_FIELD + 4  # the walk only needs to reach past the marker
# offset 38 (bit 0x40 set = shown): ``21`` is the only hidden form observed
# (``21 21`` / ``30 21``), so only that exact byte reads as hidden
_HIDDEN_BYTE = 0x21
# Offset 37 always reads 21 (30 on Y-error plots) beside a hidden offset 38
# across the whole corpus (356/356); requiring it tightens the rule for free.
_HIDDEN_PARTNERS = frozenset({0x21, 0x30})
# the omission reason of a curve whose plot Origin hides (``curve_sheet_omitted``)
HIDDEN_IN_ORIGIN = "hidden_in_origin"


def _x_field(b: bytes, tag_pos: int) -> bytes | None:
    """Record offsets 35-38 of the curve record at ``tag_pos`` (its ``80
    01|03 <id>`` chunk), or ``None`` unless the walk writes all four."""
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
    if pos < _END or not all(have[X_FIELD:_END]):
        return None
    return bytes(lit[X_FIELD:_END])


def token_x_id(b: bytes, tag_pos: int) -> int | None:
    """The X column id the curve record at ``tag_pos`` (its ``80 01|03 <id>``
    chunk) stores, ``0`` for "no X column", or ``None`` when the record's X
    field is not literally present (zero-skipped, truncated, or no marker)."""
    field = _x_field(b, tag_pos)
    if field is None or (field[2] & 0xDF, field[3] & 0xFE) not in _MARKERS:
        return None
    return int.from_bytes(field[:2], "little")


def token_hidden(b: bytes, tag_pos: int) -> bool:
    """True when the curve record at ``tag_pos`` is a plot Origin HIDES:
    offset 38 reads ``21`` (``61`` when shown; module docstring). Fail
    closed: an unwalkable record or any other value is not hidden."""
    field = _x_field(b, tag_pos)
    return field is not None and field[3] == _HIDDEN_BYTE and field[2] in _HIDDEN_PARTNERS


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
