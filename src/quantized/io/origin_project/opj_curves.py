"""Curve->column binding for ``.opj`` (CPYA) graph figures (item 11, long
presumed permanently undecodable -- solved 2026-07-04).

``docs/origin_project_format.md`` sec 6.1 previously documented the DataPlot
("X-block") record as `` 58 00 00 00 98 03 40 b3 <u32 bodyLen> <enum> ...``
with "the column selector is inside the undecoded body -- no ASCII, no plain
indices found". That body is a fixed style/geometry record and genuinely
carries no selector. The selector lives one level up: immediately BEFORE each
DataPlot's style+body pair sits a small, previously-uninvestigated "curve
anchor" record --

```
01 00 00 00  <id:u16 LE>  00 01 00 00  00 00 a1 00  ...
```

-- whose first 6 bytes are the whole story: a fixed ``01 00 00 00`` marker,
then a little-endian ``u16`` that is the plotted column's own **global,
project-wide, monotonically-assigned serial id**. Detected structurally (no
fixed size -- ``519`` in ``Moke.opj``, ``515`` in ``XRD.opj``, evidently a
per-file/build constant, not part of the encoding) by requiring the anchor be
immediately followed by a block starting with the DataPlot magic itself
(``58 00 00 00 98 03 40 b3``, the same 8 bytes sec 6.1 already documents) --
this pairing is what a real curve looks like; nothing else in a graph window
matches both halves at once.

**How this was found.** The designed experiment from the RE brief: Moke's
``Graph8``/``Graph9`` both plot ``[Book4]Sheet1!B`` and have byte-identical
block-size sequences end to end -- diffing them block-by-block isolates
*noise* (every difference was a per-graph object/window serial counter,
always off by a small constant like +7, or the window's own creation index,
off by exactly 1 between adjacent windows -- never anything column-shaped).
Diffing ``Graph8`` against ``Graph2`` (``[Book4]Sheet1!O`` -- same book,
different column, same style family) with the SAME block alignment isolates
exactly one block that is identical between ``Graph8``/``Graph9`` (the noise
pair) but differs between ``Graph8``/``Graph2`` (the signal pair): the 519-
byte block immediately preceding the first DataPlot style+body pair. Its
first differing byte (offset 4, `` 1f`` vs ``5d`` = 31 vs 93) looked at first
like a per-book column ordinal (Book2's ``D``/``H``/``L`` curves read 12/16/
20 -- exactly ``letter_position + 8``; Book3's ``B``/``C``/``D``/``E`` read
26/27/28/29 -- exactly ``letter_position + 24``) but Book4 broke that model
outright (``B``=31, ``H``=94, ``O``=93, ``M``=53, ``N``=92 -- no additive
constant fits, and creation-order position fares no better). The values
*were* unique per (book, column) pair across 15 distinct pairs and 8
independently-authored graphs, though -- exactly the profile of a real
per-column identifier, just not one derivable from position within its own
book. Cross-checking the SAME 16-bit value against each column's own
storage block in the windows section (searched independently via each
column's ``"<Book>_<Col>\\0"`` dataset-name string, unrelated to any graph) found
it verbatim, at the identical relative offset (4, u16 LE) in that block's own
header -- 5-for-5 exact matches on the first pass, then every one of the 45
curves validated below. **Book and column are resolved together by this one
id** -- there is no separate "book selector" field to find; the column's own
id implicitly carries which book it belongs to, since ids are assigned
globally across the whole project, not restarted per book.

**Column-storage lookup (`column_id_map`).** Every ≥500-byte column-storage
block in the windows section (``00 00 <Book> 00 …`` window header, then one
block per column, per sheet -- see ``windows.py``) opens with the SAME 4-byte
tag family the curve anchor uses, then this same u16 id at offset 4, then
(among other things) the column's NUL-terminated short name at offset 0x12
and its plot designation byte at 0x11 (``windows.py``'s ``_DESIGNATION``
enum: 0=Y, 3=X, ...). ``windows.py``'s own ``_is_column_block`` additionally
requires ``payload[0x06] == 0x0B``, which is too strict for this corpus --
most of ``Moke.opj``'s ``Book4``/``Book1`` Sheet1 columns carry ``0x09``
there instead (only a handful, e.g. ``Book4``'s ``H``, carry ``0x0B``), so
reusing it silently drops most columns. This module's own detector
(``_column_short_name``) only requires the size floor + a clean printable
alpha-first short name, and is scanned across ALL sheets of a book (not just
the primary one, unlike ``windows.window_metadata``) so a curve referencing
a report-sheet column (e.g. Moke's ``FitLinearCurve1``) can still resolve --
none of the corpus's *locatable* graphs happen to need this, but nothing
about the id scheme restricts it to primary-sheet columns.

**Aside -- a ``windows.window_metadata`` bug surfaced by this investigation,
FIXED 2026-07-04.** Because most of ``Book4`` Sheet1's columns failed
``_is_column_block``'s old strict check (they carry header byte ``0x09``, not
``0x0B``), ``window_metadata``'s "sheet 2 restarted" guard never triggered for
Book4's real primary sheet -- so its ``FitLinear1`` report-sheet columns got
committed as if they were the *primary* sheet's data, mislabeling Book4's
``A``-``G`` designations/long-names. Fixed in ``windows.py`` by accepting
``0x06 in (0x09, 0x0B)`` and using the real sheet-boundary signal (a 365-byte
``Pd<Name>`` sub-header at offset 0xD0) to close collection at the 2nd marker
per window. This was orthogonal to the curve/column-id decode here (which uses
its own more permissive scan and never touches ``windows.py``).

**X is a structural inference, exactly as in ``.opju`` (`book_x_columns`).**
No oracle (Moke's or XRD's ``index.json``) records which column is plotted as
X -- only the axis *range*, which doesn't identify a column. Exactly
mirroring ``opju_curves.py``'s "X is not decoded" section: ``x`` is inferred
as the book's own designated-X column (primary sheet, designation byte ``3``)
falling back to the sheet's first column when no column is explicitly marked
X. This is unverified against any oracle, here or in the ``.opju`` sibling --
a documented structural assumption, not a decoded value.

**Validation (2026-07-04, both required oracle files).**

* ``Moke.opj``: 39/39 correct, 0 wrong, on every graph reachable via a
  ``00 00 <Name> 00`` window header (``Graph1``-``Graph12``, all single- and
  multi-curve, multi-layer and cross-book cases -- ``Graph7``/``Graph10``
  each mix ``Book4``/``Book5`` curves in one window). ``FitLine``/
  ``Residual`` (the FitLinear analysis's own auto-generated report graphs, 7
  more oracle refs) have **no** ``00 00 <Name> 00`` header anywhere in the
  block stream at all (confirmed by an exhaustive string search) -- these
  live in the FitLinear analysis's own embedded storage, structurally
  unreachable via ``container.walk_blocks``, not a decode failure.
* ``XRD.opj``: 6/6 correct on ``Graph1`` (all 6 curves, one per book,
  ``Book1``/``Book5``/``Book4``/``Book3``/``Book2``/``Book6`` in that
  cross-book order -- also confirms the "book resolved via the same id, no
  separate selector" claim across 6 different books in one layer). The 18
  ``sparkline*`` refs are a structurally different feature -- per-COLUMN
  inline mini-plots embedded in the worksheet, not separate Graph windows at
  all (no ``00 00 sparklineN 00`` header exists, and a whole-file scan for
  the curve-anchor pattern -- ``01 00 00 00`` + DataPlot magic -- finds
  exactly 6 hits total in the entire file, all inside ``Graph1``): out of
  reach for this decoder by construction, not a missed match.
* **Aggregate: 45/45 correct (100% precision) on every curve this decoder can
  see at all; 45/70 (64.3%) of the full task-level oracle**, the remaining 25
  being two structurally distinct, out-of-scope window kinds (FitLinear
  report graphs; per-column sparklines) rather than undecoded curves.

See ``tests/test_io_origin_figures_opj_curves.py`` for the synthetic + real-
corpus tests and ``tools/origin_trial/score_curve_bindings_opj.py`` for a
standalone rescorer.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence

from quantized.io.origin_project.curve_style_color import apply_increment_colors, style_fields
from quantized.io.origin_project.windows import _cstring, _is_window_header

__all__ = [
    "book_column_designations",
    "book_x_columns",
    "column_id_map",
    "extract_curves",
]

# The curve-anchor record's fixed 4-byte marker (see module docstring).
_CURVE_PREFIX = b"\x01\x00\x00\x00"

# The DataPlot ("X-block") magic already documented in
# docs/origin_project_format.md sec 6.1 ("0x58 marker byte, constant magic
# 0xB3400398"). A real curve anchor is always immediately followed by a block
# opening with this exact sequence -- the co-occurrence is what makes the
# anchor detector precise without needing a fixed block size.
_DATAPLOT_MAGIC = b"\x58\x00\x00\x00\x98\x03\x40\xb3"

# windows.py's plot-designation enum (0=Y, 3=X, ...) -- see its `_DESIGNATION`.
_DESIGNATION_X = 3


def _column_short_name(payload: bytes) -> str | None:
    """A column-storage block's short name (e.g. ``"B"``), or ``None``.

    Printable, NUL-terminated, alpha-first, at payload offset ``0x12`` --
    mirrors ``windows.py``'s column-property-block layout but WITHOUT
    ``windows._is_column_block``'s stricter type-byte check, which misses
    most real columns in this corpus (see module docstring)."""
    if len(payload) < 500:
        return None
    name = _cstring(payload, 0x12, 8)
    return name if name and name[0].isalpha() else None


def _is_graph_header(blocks: Sequence[tuple[int, bytes]], i: int) -> str | None:
    """``True`` (the window name) when block ``i`` opens a GRAPH window --
    mirrors ``figures.py``'s own detector: a window header whose immediately
    following block is a layer-continuation block (>=90 B, head
    ``00 00 1f 00``)."""
    _, payload = blocks[i]
    name = _is_window_header(payload)
    if name is None:
        return None
    nxt = blocks[i + 1][1] if i + 1 < len(blocks) else b""
    if len(nxt) >= 90 and nxt[:4] == b"\x00\x00\x1f\x00":
        return name
    return None


def column_id_map(blocks: Sequence[tuple[int, bytes]]) -> dict[int, tuple[str, str]]:
    """Every workbook column's global serial id -> ``(book, column)``.

    Scanned across the whole windows section (ALL sheets of every book, not
    just the primary one -- see module docstring), skipping graph windows
    entirely (they hold no column-storage blocks of their own, but their
    internal 519-ish-byte records could otherwise false-positive against the
    permissive short-name check)."""
    id_map: dict[int, tuple[str, str]] = {}
    current_book: str | None = None
    in_graph = False
    i = 0
    n = len(blocks)
    while i < n:
        if _is_graph_header(blocks, i) is not None:
            in_graph, current_book = True, None
            i += 2
            continue
        _, payload = blocks[i]
        name = _is_window_header(payload)
        if name is not None:
            in_graph, current_book = False, name
            i += 1
            continue
        if not in_graph and current_book is not None and len(payload) >= 6:
            short = _column_short_name(payload)
            if short is not None:
                cid = struct.unpack_from("<H", payload, 4)[0]
                id_map[cid] = (current_book, short)
        i += 1
    return id_map


def book_column_designations(
    blocks: Sequence[tuple[int, bytes]],
) -> dict[str, list[tuple[str, int]]]:
    """book -> its primary sheet's columns as ``[(short_name, designation)]``
    in worksheet column order.

    Same collection as :func:`book_x_columns` (primary sheet only -- stops for
    a book at the first repeated short name, the "sheet 2 restarts at column A"
    signal ``windows.window_metadata`` uses), but keeps the FULL ordered list
    rather than collapsing to a single X. This is what lets each curve resolve
    its own X as the nearest preceding X-designated column (Origin's real
    X<->Y pairing on a multi-X worksheet) instead of forcing every curve onto
    the book's first X. Designation byte (offset ``0x11``): ``0``=Y, ``3``=X
    (``windows.py``'s ``_DESIGNATION``)."""
    order: dict[str, list[tuple[str, int]]] = {}
    seen_names: dict[str, set[str]] = {}
    closed: set[str] = set()
    current_book: str | None = None
    in_graph = False
    i = 0
    n = len(blocks)
    while i < n:
        if _is_graph_header(blocks, i) is not None:
            in_graph, current_book = True, None
            i += 2
            continue
        _, payload = blocks[i]
        name = _is_window_header(payload)
        if name is not None:
            in_graph, current_book = False, name
            i += 1
            continue
        if not in_graph and current_book is not None and current_book not in closed:
            short = _column_short_name(payload)
            if short is not None and len(payload) > 0x11:
                names = seen_names.setdefault(current_book, set())
                if short in names:
                    closed.add(current_book)  # sheet 2 restarting at the same letters
                else:
                    names.add(short)
                    order.setdefault(current_book, []).append((short, payload[0x11]))
        i += 1
    return order


def book_x_columns(blocks: Sequence[tuple[int, bytes]]) -> dict[str, str]:
    """book -> its designated X column's short name (structural inference).

    The book-level X: the first X-designated (byte ``3``) column of the
    primary sheet, falling back to that sheet's first column when none is
    marked X. Derived from :func:`book_column_designations`. See module
    docstring: NOT verified against any oracle, exactly like
    ``opju_curves.py``'s X. Retained as the columnless/last-resort fallback in
    :func:`extract_curves`; per-curve X now prefers the nearest preceding X.
    """
    out: dict[str, str] = {}
    for book, cols in book_column_designations(blocks).items():
        if not cols:
            continue
        x_col = next((c for c, d in cols if d == _DESIGNATION_X), None)
        out[book] = x_col if x_col is not None else cols[0][0]
    return out


def _nearest_preceding_x(order: Sequence[tuple[str, int]], y_short: str) -> str | None:
    """The X-designated column (byte ``3``) nearest-preceding ``y_short`` in
    worksheet column order, or ``None`` when ``y_short`` is not on this sheet
    or no X precedes it. Origin's real rule: a Y column plots against the
    closest X-designated column to its left."""
    prev_x: str | None = None
    for short, desig in order:
        if short == y_short:
            return prev_x
        if desig == _DESIGNATION_X:
            prev_x = short
    return None


def extract_curves(
    blocks: Sequence[tuple[int, bytes]],
    start: int,
    end: int,
    id_map: dict[int, tuple[str, str]],
    x_columns: dict[str, str],
    col_order: dict[str, list[tuple[str, int]]] | None = None,
) -> list[dict[str, str | float]]:
    """Every curve's ``{book, x, y}`` binding found in ``blocks[start:end)``.

    ``y`` is decoded exactly via the curve anchor's own global column id (see
    module docstring). ``x`` is resolved per curve as the nearest preceding
    X-designated column on ``y``'s sheet when ``col_order`` (from
    :func:`book_column_designations`) is supplied -- Origin's real multi-X
    pairing -- else the book-level designated X in ``x_columns``. A curve
    whose id doesn't resolve to a known column, or whose book has no inferable
    X column, is silently dropped -- never guessed. The anchor payload is also
    the curve's fixed style record
    (``curve_style_color.py``: symbol color/kind, line color, line-vs-
    scatter -- oracle-verified on ``hc2convert.opj``), so any decodable
    ``color``/``symbol``/``style`` keys ride along; undecodable fields
    (auto color, unmapped bytes) are absent, never defaulted."""
    out: list[dict[str, str | float]] = []
    records: list[bytes | None] = []
    last = min(end, len(blocks) - 1)
    for j in range(start, last):
        _, payload = blocks[j]
        if len(payload) < 6 or payload[:4] != _CURVE_PREFIX:
            continue
        _, npayload = blocks[j + 1]
        if npayload[:8] != _DATAPLOT_MAGIC:
            continue
        cid = struct.unpack_from("<H", payload, 4)[0]
        info = id_map.get(cid)
        if info is None:
            continue
        book, col = info
        # Per-curve X: the nearest preceding X-designated column on the book's
        # sheet (Origin's real multi-X pairing); fall back to the book-level
        # designated X only when that can't be resolved.
        x: str | None = None
        if col_order is not None and book in col_order:
            x = _nearest_preceding_x(col_order[book], col)
        if x is None:
            x = x_columns.get(book)
        if x is None:
            continue  # unknown/columnless book: drop, never guess
        out.append({"book": book, "x": x, "y": col, **style_fields(payload)})
        records.append(payload)
    # auto/increment placeholders resolve by group role + plot order
    # (curve_style_color.apply_increment_colors, pixel-oracle-verified)
    apply_increment_colors(out, records)
    return out
