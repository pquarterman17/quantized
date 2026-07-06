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
```

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
from typing import NamedTuple

from quantized.io.origin_project.curve_style_color import opju_style_record, style_fields
from quantized.io.origin_project.opju_codec import curve_plot_style
from quantized.io.origin_project.tree_opju import _OPJU_WIN_RE

__all__ = ["ColumnIdTable", "column_id_table", "extract_curves_by_id", "opju_pages"]

# Column-record id field, form A / form B (see module docstring).
_ID_FORM_A = re.compile(rb"\x01\x10\x80\x03(..)", re.DOTALL)
_ID_FORM_B = re.compile(rb"\x07\x10\x01\x00\x00(..)", re.DOTALL)

# The unified curve token: <flag> 01 01 01 80 <width> <id…> (module docstring).
_CURVE_TOKEN = re.compile(rb"\x01\x01\x01\x80([\x01\x03])", re.DOTALL)

# Per-column plot-designation markers (same bytes windows_opju.py validates).
_MARKS = {b"\x21\x51": "X", b"\x21\x61": "Y", b"\x30\x61": "Y-error"}

_MAX_FIELDS = 10  # field-walk runaway backstop; real records resolve in <= 6
_NAME_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,15}\Z")


class ColumnIdTable(NamedTuple):
    """The decoded global column-id table of one ``.opju`` byte stream.

    ``ids``: column id -> ``(book page name, column short name)``.
    ``x_partner``: a Y column's id -> its designated X partner column's id.
    ``book_x``: book -> its first X-designated column's short name.
    ``book_pages``: page names that own >= 1 column record (i.e. workbook /
    report-table pages — used by ``figures_opju`` to tell a graph page from
    a book page when attaching window names to figures).
    """

    ids: dict[int, tuple[str, str]]
    x_partner: dict[int, int]
    book_x: dict[str, str]
    book_pages: frozenset[str]


def opju_pages(b: bytes) -> list[tuple[int, str]]:
    """Every ``0a``-framed page header as ``(offset, name)``, file order.

    Reuses the exact enumeration ``tree_opju`` validated byte-exact against
    live COM (first occurrence per name; the ``namelen+2`` self-check rejects
    coincidental matches inside data).
    """
    out: list[tuple[int, str]] = []
    seen: set[str] = set()
    for m in _OPJU_WIN_RE.finditer(b):
        name = m.group(2).decode("latin1")
        if m.group(1)[0] == len(name) + 2 and name not in seen:
            seen.add(name)
            out.append((m.start(), name))
    return out


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
    to a book and are ignored.
    """
    ids: dict[int, tuple[str, str]] = {}
    poisoned: set[int] = set()
    x_partner: dict[int, int] = {}
    book_x: dict[str, str] = {}
    book_pages: set[str] = set()
    bounds = [*pages, (len(b), "")]
    for (start, book), (end, _next) in zip(bounds, bounds[1:], strict=False):
        for pattern in (_ID_FORM_A, _ID_FORM_B):
            for m in pattern.finditer(b, start, end):
                cid = int.from_bytes(m.group(1), "little")
                parsed = _parse_column_record(b, m.end())
                if parsed is None:
                    continue
                name, desig, partner = parsed
                if cid in ids and ids[cid] != (book, name):
                    poisoned.add(cid)
                    continue
                ids[cid] = (book, name)
                book_pages.add(book)
                if partner is not None:
                    x_partner[cid] = partner
                if desig == "X" and book not in book_x:
                    book_x[book] = name
    for cid in poisoned:
        ids.pop(cid, None)
        x_partner.pop(cid, None)
    return ColumnIdTable(ids, x_partner, book_x, frozenset(book_pages))


def extract_curves_by_id(
    b: bytes, start: int, end: int, table: ColumnIdTable
) -> list[dict[str, str]]:
    """Every curve binding in ``b[start:end)`` via the unified id token.

    ``y`` resolves through ``table.ids`` (a token whose id is unknown is
    dropped, never guessed). ``x`` is the Y column's own stored X-partner
    when its record carried one, else the book's first X-designated column,
    else ``"A"`` (the documented structural fallback). Deduped on
    ``(book, y)`` in first-seen (token) order; ``style`` is attached when
    ``opju_codec.curve_plot_style`` finds the ``8f 01 <style> 83`` tag
    (falling back to the reconstructed record's own style byte), and
    ``color``/``symbol`` when the token's sparse style record decodes
    (``curve_style_color.py`` -- oracle-verified on the ``Hc2 data``/
    ``RockingCurve``/``UnpolPlots`` ``curve_style.json`` oracle; auto/
    undecodable fields stay absent, never defaulted).
    """
    out: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for m in _CURVE_TOKEN.finditer(b, start, end):
        width = m.group(1)[0]
        if m.end() + width > len(b):
            continue
        if width == 1:
            cid = b[m.end()]
        else:
            cid = int.from_bytes(b[m.end() : m.end() + 2], "little")
        info = table.ids.get(cid)
        if info is None:
            continue
        book, y_col = info
        key = (book, y_col)
        if key in seen:
            continue
        seen.add(key)
        partner = table.x_partner.get(cid)
        partner_info = table.ids.get(partner) if partner is not None else None
        if partner_info is not None and partner_info[0] == book:
            x_col = partner_info[1]
        else:
            x_col = table.book_x.get(book, "A")
        curve = {"book": book, "x": x_col, "y": y_col}
        # the token IS the sparse form of the .opj curve-anchor record; the
        # id chunk's 0x80 tag sits 3 bytes into the regex match
        record = opju_style_record(b, m.start() + 3)
        if record is not None:
            curve.update(style_fields(record))
        # the shipped 8f-tag reader stays authoritative for line/scatter
        style = curve_plot_style(b, m.start())
        if style:
            curve["style"] = style
        out.append(curve)
    return out
