"""``.opju`` (CPYUA) figure->curve binding via the global column-id table.

**The discovery (2026-07-05, the Hc2 per-graph rework).** The two curve-token
"families" ``opju_curves.py`` / ``opju_curves_allcols.py`` decode by *counting
columns* (``<flag> 01 01 01 80 03 <y_ord> 00`` and ``… 80 01 <val>``) are in
fact ONE encoding, and the value is not an ordinal to count at all: it is the
plotted column's own **global, project-wide, creation-order serial id** — the
exact CPYUA analogue of the ``.opj`` curve-anchor id ``opj_curves.py`` decodes.
The token's id field is a tagged variable-width little-endian integer:

```
<flag:1> 01 01 01 80 <width:01|03> <payload>
    width 0x01 -> payload = <id:u8>
    width 0x03 -> payload = <id:u16 LE> <flag:1>   (3rd byte varies: 01/09/0b/
                                                    0c/11/21 observed; not id)
```

The old ``0x03``-family regex required the byte after the id byte to be
``0x00`` — that byte is really the u16 id's HIGH byte, so the old reader
worked only on projects with < 256 columns and silently aliased ids mod 256
on larger ones (measured on ``Hc2 data.opju``: 1251+ allocated columns, 12 of
14 decoded bindings wrong before this rework). The counting conventions the
old modules validated were an artifact: in a never-edited project, creation
order equals current layout order, so the cumulative all-columns ordinal
happens to equal the stored id. ``Hc2 data`` (heavily edited: columns added
to early books after later books existed, e.g. the ``Derivative Y1`` column
``AH`` of the first Lockin book carrying id 132) breaks the count and proves
the id semantics.

**The id table.** Every worksheet column's own windows-section record stores
that id. Two record forms exist (both validated against the per-column
designation-marker runs ``windows_opju.py`` independently decodes):

```
form A:  80 <serial> 01 10 80 03 <id:u16 LE> <pb> <fields…>
form B:  80 <serial> 07 10 01 00 00 <id:u16 LE> <pb> <fields…>
form A1: 80 <serial> 01 10 80 01 <id:u8> <fields…>          (no <pb>)
form B1: 80 <serial> 05 10 01 00 00 <id:u8> <fields…>       (no <pb>)
```

Forms A1/B1 are A/B with the curve token's own u8 id width (``80 01 <id>``):
54 records corpus-wide (53 A1 + 1 B1), all in
``pedotpss_IV_2019-08-01.opju`` (``Book1`` B..AB of two sheets), the
columns Origin plots in its Graph2/Graph7 (plan item 68); every other corpus
match of those bytes fails the field walk.

``<pb>`` is one uninterpreted byte (``03/09/0b/0c`` observed). ``<fields…>``
is a run of tagged fields ``<tag:0x80-0x9f> <len:u8> <payload:len>``:

* the column's **short name**: payload = optional designation prefix byte
  (``0x03`` on X columns, ``0x02`` on Y-error columns) + the ASCII name;
  identified as the first alnum-payload field whose *next* field's payload
  opens with ``0x09``;
* a fixed ``<tag> 01 09`` separator field;
* the field carrying the 2-byte **plot-designation marker** as its payload
  tail — ``21 51`` X / ``21 61`` Y / ``30 61`` Y-error, the same markers
  ``windows_opju.py`` anchors label runs on; a Y column's marker field is
  exactly 4 bytes — ``<x_partner_id:u16 LE> 21 61`` — giving the column's own
  designated **X partner column id** (validated: Hc2's ``Derivative Y1``
  column AH, id 132, carries partner id 131 = its sibling ``Derivative X1``
  column AG, not the sheet's column A).

Records are attributed to their book by the containing **page span**: the
``0a``-framed page headers ``tree_opju._OPJU_WIN_RE`` already enumerates
(byte-exact vs live COM on 5 corpus files) mark every window's start; a
column record belongs to the page (workbook) whose span it falls in.

**Form B semantics are unknown** beyond carrying the same id+fields: it is
rare (RockingCurve ``NbAu!D``/``NbAl!B``, UnpolPlots ``PrNiO3STOprof!B``/
``PrNiO3STOrefl!I`` — exactly the four bindings the form-A-only table
missed) and never overlaps form A ids (checked corpus-wide: 0 overlaps in
28 files). Both forms parse identically after the id.

**Validation (2026-07-05).**

* File-level ``plots.json`` oracle (7 stems, 36 unique pairs): 36/36 decoded,
  0 wrong — same aggregate as the shipped counting decoders, now via ids.
* Per-graph ``index.json`` oracle (``Hc2 data``, the first stem whose export
  populated ``graphs[].layers[].plots``): decoded figures are matched to
  oracle graphs by their *page name* (see ``figures_opju.py``); 7 of the 8
  oracle graphs that exist as real graph pages bind exactly (Graph1/2/4/6/8/
  10/11 — every ``(book, column)`` set identical to the oracle, including
  u16 ids > 255 and the id-132 later-added column). 0 wrong bindings.
* ``Graph5`` (single-curve, [A6221LockinD3]!I) is a **documented negative**:
  its page span contains no curve token at all — its two DataPlot-magic
  objects carry no recognisable id field (a diffed/duplicate-window form,
  byte-dumped in the RE log). It decodes with ``curves == []`` (missing,
  never guessed). Do NOT be tempted by the ``90 00 80 <tag> 01 89`` bytes in
  its ``_202``/``_232`` sub-objects: that shape occurs in EVERY graph page of
  the corpus with the constant 0x89 (and 0x02) regardless of what is plotted
  — a style-boilerplate coincidence that happens to equal Graph5's true
  column id 137, chased and refuted during this rework.
* Embedded fit-report graphs (the oracle's ``FitLine*``/``Residual*`` pages,
  which are NOT ``0a``-framed pages): their report-sheet spans (Book2/Book3)
  carry one canonical token per embedded layer anchor, resolving to the
  fitted source column (Book2!C/D/E) — in-oracle, but per-graph attribution
  for them is unverifiable (no page name), so they ship on unnamed figures
  only. The fit-CURVE overlays (``FitNLCurveN!B`` etc.) are not
  token-encoded anywhere and are honestly missing.

The old counting decoders stay in place as the fallback for byte streams
with no id table at all (synthetic fixtures; degraded files): see
``figures_opju.extract_figures_opju``.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from collections.abc import Mapping
from typing import NamedTuple

from quantized.io.origin_project.curve_style_color import (
    apply_increment_colors,
    opju_style_record,
    style_fields,
)
from quantized.io.origin_project.opju_codec import curve_plot_style
from quantized.io.origin_project.opju_column_fixed import fixed_column_record
from quantized.io.origin_project.opju_curve_range import range_reason
from quantized.io.origin_project.opju_curve_sheets import curve_sheet, sheet_x_names
from quantized.io.origin_project.opju_curve_token import (
    CURVE_TOKEN,
    column_id_records,
    is_shipped_form,
    token_id,
)
from quantized.io.origin_project.opju_curve_token_x import token_x
from quantized.io.origin_project.opju_embedded_pages import span_pages
from quantized.io.origin_project.opju_plot_gates import error_bar_reason, withhold_step_style
from quantized.io.origin_project.opju_sheet_signals import SheetGates, newly_proven_reason
from quantized.io.origin_project.tree_opju import iter_opju_windows

__all__ = ["ColumnIdTable", "column_id_table", "extract_curves_by_id", "opju_pages"]


# The unified curve token: <flag> 01 01 01 80 <width> <id…> (module docstring).
_CURVE_TOKEN = re.compile(rb"\x01\x01\x01\x80([\x01\x03])", re.DOTALL)

# Per-column plot-designation markers (same bytes windows_opju.py validates).
_MARKS = {b"\x21\x51": "X", b"\x21\x61": "Y", b"\x30\x61": "Y-error"}

_MAX_FIELDS = 10  # field-walk runaway backstop; real records resolve in <= 6
# Column short-name gate: no 16-char ceiling (the old {0,15} was a corpus
# maximum — a longer user-renamed short name made the column's id unresolvable
# and silently dropped every curve plotting it; 2026-07-06 genericity audit).
# The structural guards (the 09-separator field walk + designation marker)
# carry the precision; digit-led short names are legal in Origin.
_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_]*\Z")


class ColumnIdTable(NamedTuple):
    """The decoded global column-id table of one ``.opju`` byte stream.

    ``ids``: column id -> ``(book page name, column short name)``.
    ``x_partner``: a Y column's id -> its designated X partner column's id.
    ``book_x``: book -> its first X-designated column's short name.
    ``book_pages``: page names that own >= 1 column record (i.e. workbook /
    report-table pages — used by ``figures_opju`` to tell a graph page from
    a book page when attaching window names to figures).
    ``x_ids``: every X-designated column id, in scan order (the per-sheet
    X of a re-bound curve with no stored partner: ``opju_curve_sheets``).
    """

    ids: dict[int, tuple[str, str]]
    x_partner: dict[int, int]
    book_x: dict[str, str]
    book_pages: frozenset[str]
    x_ids: tuple[int, ...] = ()
    yerr_ids: frozenset[int] = frozenset()  # Y-error-designated column ids


def opju_pages(b: bytes) -> list[tuple[int, str]]:
    """Every ``0a``-framed page header as ``(offset, name)``, file order.

    Reuses the exact enumeration ``tree_opju`` validated byte-exact against
    live COM (first occurrence per name; the ``namelen+2`` length prefix
    drives the name span, so arbitrary-length window names enumerate — a
    missed header here would attribute every column in its span to the
    previous page). Embedded report-graph headers are left out: they sit
    inside their host workbook and do not end its span
    (``opju_embedded_pages``).
    """
    return span_pages(b, iter_opju_windows(b))  # embedded report graphs don't end a book


def _walk_fields(b: bytes, p: int) -> list[bytes]:
    """The tagged-field run at ``p``: payload per ``<tag 0x80-0x9f> <len>
    <payload>`` field, stopping at the first byte that isn't a field tag."""
    out: list[bytes] = []
    n = len(b)
    for _ in range(_MAX_FIELDS):
        if p + 2 > n or not 0x80 <= b[p] <= 0x9F:
            break
        ln = b[p + 1]
        payload = b[p + 2 : p + 2 + ln]
        if len(payload) < ln:
            break
        out.append(payload)
        p += 2 + ln
    return out


def _parse_column_record(b: bytes, after_id: int) -> tuple[str, str | None, int | None] | None:
    """Decode one column record's field run (starting just past the id).

    Returns ``(short_name, designation, x_partner_id)`` or ``None`` when the
    record doesn't resolve — dropped, never guessed. The name field must be
    followed by the fixed ``09`` separator field AND a designation-marker
    field within the next 3 fields (both checks together are what reject
    coincidental byte runs; see module docstring).
    """
    fields = _walk_fields(b, after_id + 1)  # +1: skip the uninterpreted <pb> byte
    for i in range(len(fields) - 1):
        payload = fields[i]
        body = payload[1:] if payload[:1] in (b"\x02", b"\x03") else payload
        try:
            name = body.decode("ascii")
        except UnicodeDecodeError:
            continue
        if not _NAME_RE.match(name) or fields[i + 1][:1] != b"\x09":
            continue
        for later in fields[i + 1 : i + 4]:
            if len(later) >= 2 and later[-2:] in _MARKS:
                desig = _MARKS[later[-2:]]
                partner: int | None = None
                if desig == "Y" and len(later) == 4:
                    partner = int.from_bytes(later[:2], "little")
                return name, desig, partner
        return None  # name shape found but no designation marker: not a column record
    return None

def column_id_table(b: bytes, pages: list[tuple[int, str]]) -> ColumnIdTable:
    """Scan every page span for column records and build the global id table.

    A record whose fields don't resolve is skipped; an id claimed twice with
    *different* ``(book, column)`` is poisoned (removed entirely) — fail
    closed, never guess. Records outside any page span cannot be attributed
    to a book and are ignored. A record the field walk rejects is read at its
    fixed offsets (``opju_column_fixed``: a column whose format is not Text &
    Numeric); such records only add ids the field walk did not resolve.
    """
    ids: dict[int, tuple[str, str]] = {}
    poisoned: set[int] = set()
    x_partner: dict[int, int] = {}
    book_x: dict[str, str] = {}
    x_ids: list[int] = []
    yerr: set[int] = set()
    book_pages: set[str] = set()
    bounds = [*pages, (len(b), "")]
    walked: list[tuple[str, int, tuple[str, str | None, int | None]]] = []
    fixed: list[tuple[str, int, tuple[str, str | None, int | None]]] = []
    for (start, book), (end, _next) in zip(bounds, bounds[1:], strict=False):
        for off, cid, fields in column_id_records(b, start, end):
            parsed = _parse_column_record(b, fields - 1)  # it skips one <pb> byte
            if parsed is not None:
                walked.append((book, cid, parsed))
            elif (got := fixed_column_record(b, off)) is not None:
                fixed.append((book, cid, got))  # a non-Text&Numeric column
    # the fixed-offset records only ADD ids: one the field walk already
    # resolved (or poisoned) is never touched by them (opju_column_fixed)
    walked_ids = {cid for _book, cid, _p in walked}
    added = [rec for rec in fixed if rec[1] not in walked_ids]
    for book, cid, (name, desig, partner) in [*walked, *added]:
        if cid in ids and ids[cid] != (book, name):
            poisoned.add(cid)
            continue
        ids[cid] = (book, name)
        book_pages.add(book)
        if partner is not None:
            x_partner[cid] = partner
        if desig == "Y-error":
            yerr.add(cid)
        if desig == "X":
            x_ids.append(cid)
            book_x.setdefault(book, name)
    for cid in poisoned:
        ids.pop(cid, None)
        x_partner.pop(cid, None)
    kept_x = tuple(dict.fromkeys(c for c in x_ids if c in ids))
    return ColumnIdTable(ids, x_partner, book_x, frozenset(book_pages), kept_x, frozenset(yerr))


def _yerr_x_unproven(
    m: re.Match[bytes],
    cid: int,
    partner: int | None,
    table: ColumnIdTable,
    prev: tuple[str, str] | None,
    this: tuple[str, str],
) -> bool:
    """A Y-error column plotted with no X of its own (no token X, no stored
    partner) through a newly read id-chunk width (``opju_curve_token``):
    Origin draws it against the X of the Y it decorates, the curve before it
    (COM: optimal_MOI Graph5 ``Book29_D`` against ``Book29_B``, where the
    book's first X is ``A``). When the previous curve is on the same sheet
    against another X than the fallback, the X is unproven; a first curve,
    or one after another sheet's, keeps the fallback (PerceivedRisk Graph35
    ``Book1DAA_B@3`` -- COM-identical against ``A``)."""
    if partner is not None or cid not in table.yerr_ids or is_shipped_form(m):
        return False
    return prev is not None and prev[0] == this[0] and prev[1] != this[1]


def extract_curves_by_id(
    b: bytes,
    start: int,
    end: int,
    table: ColumnIdTable,
    off_sheet: Mapping[int, str] | None = None,
    omitted: list[tuple[int, dict[str, str]]] | None = None,
    gates: SheetGates | None = None,
) -> list[dict[str, str | float]]:
    """Every curve binding in ``b[start:end)`` via the unified id token.

    ``y`` resolves through ``table.ids`` (a token whose id is unknown is
    dropped, never guessed). ``x`` is the X the token's own record stores
    (``opju_curve_token_x``; a record X that names no column, an unknown
    column or another book's omits the curve), else the Y column's stored
    X-partner when its record carried one, else the book's first
    X-designated column, else ``"A"`` (the documented structural fallback). Deduped on
    ``(book, y)`` in first-seen (token) order; ``style`` is attached when
    ``opju_codec.curve_plot_style`` finds the ``8f 01 <style> 83`` tag
    (falling back to the reconstructed record's own style byte), and
    ``color``/``symbol`` when the token's sparse style record decodes
    (``curve_style_color.py`` -- oracle-verified on the ``Hc2 data``/
    ``RockingCurve``/``UnpolPlots`` ``curve_style.json`` oracle; auto/
    undecodable fields stay absent, never defaulted).

    ``off_sheet`` (``opju_curve_sheets.off_sheet_ids``) names the sheet of
    every column id not on its book's first sheet. A curve on sheet N binds
    to the importer's pseudo-book ``Book@N`` (``opju_curve_sheets.curve_sheet``
    decides; ``x`` keeps its column NAME, which the frontend looks up in that
    pseudo-book). A curve whose sheet is not proven is left out -- after
    colour resolution, so the kept curves keep their plot-order colours --
    and appended to ``omitted`` as ``(plot index, {book, x, y, recorded,
    reason})``; the index is the curve's position in plot order, the order
    ``legend_labels`` follows. ``gates`` (``opju_sheet_signals.sheet_map``)
    omits the same way a curve whose book carries a worksheet data filter
    (``worksheet_filter``) and a curve placed only by the second sheet signal
    when ``opju_sheet_signals.newly_proven_reason`` gives a reason, or when the
    layer plots it again (``plotted_twice``). Dedup is per
    ``(book, y, sheet)``, so a layer plotting ``B`` of two sheets keeps both.
    """
    off = off_sheet or {}
    out: list[dict[str, str | float]] = []
    records: list[bytes | None] = []
    notes: list[dict[str, str]] = []  # per curve: its sheet note (reason "" = kept)
    seen: dict[tuple[str, str, str], int] = {}  # key -> its curve's index
    placed: set[int] = set()  # indices of curves the second/third sheet signal placed
    sheet_x: dict[str, str] | None = None  # built on first need
    prev: tuple[str, str] | None = None  # the previous curve's (sheet, X)
    token_starts: list[int] | None = None  # built on first need
    tokens = list(CURVE_TOKEN.finditer(b, start, end))  # every id-chunk width
    # the forms read before (opju_curve_token): where one names the
    # same id, it keeps the curve (and its colour) the shipped dedup kept
    shipped = {token_id(b, t) for t in tokens if is_shipped_form(t)}
    for m in tokens:
        cid = token_id(b, m)
        if cid is None or (not is_shipped_form(m) and cid in shipped):
            continue
        info = table.ids.get(cid)
        if info is None:
            continue
        book, y_col = info
        partner = table.x_partner.get(cid)
        # the token's own X (record offset 35) outranks the Y's designated X
        partner, x_reason = token_x(b, m.start() + 3, book, partner, table.ids)
        partner_info = table.ids.get(partner) if partner is not None else None
        if partner_info is not None and partner_info[0] == book:
            x_col = partner_info[1]
        else:
            partner = None  # no same-book partner: the book's X name stands in
            x_col = table.book_x.get(book, "A")
        sheet, reason = curve_sheet(cid, book, partner, off)
        if partner is None and not reason and sheet != book:
            # re-bound with no stored partner: sheet N's own first X column
            if sheet_x is None:
                sheet_x = sheet_x_names(table.ids, table.x_ids, off)
            x_col = sheet_x.get(sheet, x_col)
            reason = "" if sheet in sheet_x else "x_sheet_unproven"
        reason = reason or x_reason
        if not reason and gates is not None and book in gates.filtered_books:
            reason = "worksheet_filter"  # rows Origin filters out (opju_sheet_signals)
        newly = gates.newly if gates is not None else frozenset()
        if not reason and (cid in newly or partner in newly):  # placed by opju_sheet_signals
            if token_starts is None:  # the token's record runs to the next token
                token_starts = [t.start() for t in tokens] + [end]
            span = (m.end(), token_starts[bisect_right(token_starts, m.start())])
            reason = newly_proven_reason(
                b, cid, x_col, span, (start, end), table.ids, table.x_ids
            )
        if not reason and _yerr_x_unproven(m, cid, partner, table, prev, (sheet or book, x_col)):
            reason = "x_unproven"
        key = (book, y_col, sheet)
        if key in seen:
            # Origin plots the same column again (row-range parts, SOP_meas
            # Graph12 ``figSOPvsR_E`` x3, 4 of 15 rows first): undecoded, so a
            # curve only the new sheet signals place is withheld (plan item 67)
            k = seen[key]
            if k in placed and not notes[k]["reason"]:
                notes[k]["reason"] = "plotted_twice"
            continue
        seen[key] = len(out)
        if cid in newly or partner in newly:
            placed.add(len(out))
        curve: dict[str, str | float] = {"book": sheet or book, "x": x_col, "y": y_col}
        # the token IS the sparse form of the .opj curve-anchor record; the
        # id chunk's 0x80 tag sits 3 bytes into the regex match
        record = opju_style_record(b, m.start() + 3)
        if record is not None:
            curve.update(style_fields(record))
        if not reason:  # a plot of part of its column: no row-range binding
            reason = range_reason(b, record, sheet or book, y_col)
        # an error-bar DataPlot: bars drawn from designations, never a line
        reason = error_bar_reason(record) or reason
        # the shipped 8f-tag reader stays authoritative for line/scatter
        style = curve_plot_style(b, m.start())
        if style:
            curve["style"] = style
        withhold_step_style(curve, record)  # drawn as straight segments otherwise
        out.append(curve)
        prev = (sheet or book, x_col)
        records.append(record)
        notes.append({"book": book, "x": x_col, "y": y_col, "recorded": sheet, "reason": reason})
    # auto/increment placeholders resolve by group role + plot order
    # (curve_style_color.apply_increment_colors, pixel-oracle-verified)
    apply_increment_colors(out, records)
    kept: list[dict[str, str | float]] = []
    for i, (curve, note) in enumerate(zip(out, notes, strict=True)):
        if not note["reason"]:
            kept.append(curve)
        elif omitted is not None:  # unique: `seen` already deduped the key
            omitted.append((i, note))
    return kept
