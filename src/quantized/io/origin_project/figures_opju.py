"""Extract figure definitions from ``.opju`` (CPYUA) graph windows (items 14+33).

CPYUA stores a graph *layer*'s axis descriptor as a self-contained record, found
by scanning for the 4-byte marker ``03 00 00 1f`` (validated: it opens every
axis record in every graph tested — controlled specimens *and* real corpus
files, across both CPYUA builds seen, ``4.3380`` and ``4.3811``). Two record
forms exist, both decoded here:

**Specimen form** (default-dialog graphs, the item-14 shape): after the marker
come the X-axis ``(from, to)`` values, a step field, a fixed 8-byte marker
``81 04 06 00 00 01 c3 66`` whose *next byte* is a **combined axis-scale flag**
(``0x03`` X-lin+Y-lin / ``0x04`` X-log+Y-lin / ``0x0d`` Y-log — pinned from
four controlled specimens toggling X, Y, and both; see ``_axis_scales`` and
``tools/origin_trial/generate_specimens*``). Y-scale is always exact from that
byte. X-scale is exact from the NEXT field (solved 2026-07-06): the "filler"
after the type byte is really ``7b 40`` + a 2-value X-scale field, ``01`` =
linear / ``08 01`` = log10 — the same encoding the real form carries before
its Y span (``opju_axis_real_form._real_x_log_flag``, pinned by the
fig_log/fig_xylog byte-diff); it is what encodes X when the combined byte
reads ``0x0d``, with the byte's ``0x03``/``0x04`` reading as fallback. Then Y
``(from, to)`` + step. Values are a 2-byte tag + 8-byte LE float64 literal, a
bare literal, or a 2-byte tag + 1-3 *significant* bytes (the double's
big-endian top-N bytes stored reversed); an exactly-zero ``from`` is elided
entirely. The tag itself was never cracked, so every admissible split of a
value span is tried and accepted **only** when exactly one split parses
plausibly and consumes the span exactly.

**Real-corpus form** (bound curves / non-default axis dialogs, the item-33
shape, solved 2026-07-04 against the 4-file ground-truth oracle — see
``docs/origin_re/opju_container.md``):

```
03 00 00 1f                       layer anchor
[optional flag token]             1-2 bytes, skipped (see below)
[X from] [X to] [X step]          value tokens; ``from`` elided when 0.0
81 <id> <plen> 00 00 01 …         separator (layer geometry; plen VARIES
                                  and is only a search-window hint)
[Y from] [Y to] [Y step]          value tokens (tagged/RLE only)
81 <id> <plen> 00 00 01 …         end separator
```

Real-form value tokens add two encodings to the specimen set:

* **tagged compact**: ``8T nn <nn bytes>`` with tag byte in ``0x81..0x8f`` and
  ``nn`` = payload length — payload is the double's BE top-``nn`` reversed;
* **RLE-compressed literal**: a byte-run inside the 8 LE double bytes
  collapses to a ``c2``/``c3`` escape. **Count law (solved by constraint-fit
  across every instance in the corpus): ``c2`` = a run of exactly 5 repeated
  bytes, ``c3`` = exactly 6.** The byte *after* the repeated byte is a
  context/tag byte (values 01/02/03/0a observed for identical run structures —
  NOT a count; skipped), then literal suffix bytes complete the 8. Two
  alignments occur: lead form ``<lead> c2/c3 <rep> <ctx> <suffix…>`` (run
  covers double bytes 1..N) and run-first form ``c2/c3 <rep> <ctx> <suffix…>``
  (run covers bytes 0..N-1; e.g. 1.4 = ``c3 66 03 f6 3f``);
* **bare compact**: 1-3 significant bytes with *no* tag, directly after a flag
  token (e.g. ``f0 3f`` = 1.0).

The optional X flag token (``89 01``/``89 18``/``97 03``/``91 09`` = 2 bytes;
a bare ``91`` directly before a run-first RLE value = 1 byte; absent when the
record opens with a tagged value) is skipped via a deterministic length
rule; its semantics stay undecoded. Spans decode by exact-fill: X tries
``[from, to, step]`` then ``[to, step]`` (from elided) after the flag skip;
Y scans for its start (the separator payload length varies) using tagged/RLE
tokens first, with a flag-authenticated bare-literal retry for panel layers.
A span whose fills disagree is dropped, never guessed.

**Both axis-scale flags are exact in this form** (Y solved 2026-07-04, X
2026-07-06, both against the 4-file by-construction rf_* oracle plus the
real-corpus proof): see ``opju_axis_real_form.py``'s ``_real_y_log_flag`` /
``_real_x_log_flag`` for the byte-level trails. Both use the same two byte
values (``01 00``-family = linear, ``08 01`` = log10) as the independently-
discovered ``.opj`` Y flag (``figures.py``'s ``_y_scale_flag``) — strong
cross-container corroboration. ``x_log``/``y_log`` use these flags when
present, decade heuristic only otherwise (e.g. the six Hc2 records whose X
field reads an unrecognized ``02``).

Validated end-to-end against Origin's own ground-truth export: all 6 specimen
layers (``fig_lin``/``fig_log``/``fig_pairs``) decode exactly via the specimen
form (plus the X-scale diff pair ``fig_linx``/``fig_logx`` and both-log
``fig_xylog`` that pinned the flags), and **all real-corpus anchors**
(RockingCurve 3+3, XAS 3, UnpolPlots 4+4, "Fixed Lambdas SI" 4+4 — the +N
are the ``03 00 00 5f`` panel-layer anchors of composite/panel windows,
incl. the real log-x ``Graph6``) decode with exact axis ranges and correct
lin/log via the real form. The real-corpus-form value tokens, span decoding,
and both scale flags live in ``opju_axis_real_form.py`` (split out to stay
under the 500-line god-module ceiling).

This module fills ``source_hint`` from the ``<BKNAME>...</BKNAME>`` OriginStorage
XML tag when one appears near the graph (an unambiguous, low-false-positive
signal, unlike blind name-scanning) and ``n_curves`` from the legend text's
``\\l(n)`` indices, mirroring ``figures.py`` exactly. The per-layer graph
*window name* (Origin's "Graph1" etc.) is not recoverable with the current
understanding, so ``name`` is always ``""``.

**Curve-to-dataset binding — REWORKED 2026-07-05 (the Hc2 per-graph pass;
supersedes item 35's counting decoders).** The curve token's value is the
plotted column's **global creation-order serial id** (a tagged u8/u16 LE
field, NOT an ordinal to count), resolved through the per-column id table
each workbook column's own windows-section record stores — see
``opju_figure_curves.py``'s module docstring for the full byte grammar,
the validation trail (36/36 file-level oracle pairs, 7/8 per-graph-exact on
the ``Hc2 data`` oracle's real graph pages, 0 wrong bindings anywhere), and
the documented negatives (``Graph5``'s tokenless duplicate-window curve
objects; the ``90 00 80 … 89`` style-boilerplate trap). Windows are scoped
by the ``0a``-framed **page span** (the same page headers ``tree_opju``
validated against live COM), which both kills the old cross-window
attribution leaks and recovers each figure's real window ``name``
(``"Graph1"`` …) for pages that own no column records (graph pages).
``x`` is the Y column's own stored X-partner id when present (e.g. Hc2's
``Derivative Y1`` pairs with ``Derivative X1``, not column A), else the
book's X-designated column, else ``"A"``.

The pre-rework counting decoders (``opju_curves.py`` /
``opju_curves_allcols.py``) remain as the fallback for byte streams whose
id table is empty (synthetic fixtures, template files): their counting
conventions equal the stored ids only for never-edited projects, which is
exactly what the synthetic corpus is. On a real edited project they alias
(measured: 12 of 14 bindings wrong on ``Hc2 data`` before this rework), so
the id table always wins when present.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from typing import Any

from quantized.io.origin_project.annotation_marks import _AUTO_TITLE
from quantized.io.origin_project.annotation_marks import _clean_annotations as _drop_internal_noise
from quantized.io.origin_project.figure_text import _LEGEND_RE, _texts_in
from quantized.io.origin_project.figures import _log_heuristic
from quantized.io.origin_project.opju_axis_real_form import (
    _TAG_SEARCH_SPAN,
    _decode_compact,
    _decode_raw8,
    _parse_real_record,
)
from quantized.io.origin_project.opju_curves import (
    allocated_columns_from_bytes,
    book_columns_from_bytes,
    book_metadata_from_bytes,
    extract_curves,
)
from quantized.io.origin_project.opju_figure_curves import (
    column_id_table,
    extract_curves_by_id,
    opju_pages,
)
from quantized.io.origin_project.opju_figure_text import routed_figure_text

__all__ = ["extract_figures_opju"]

_ANCHOR = bytes.fromhex("0300001f")
# Panel/composite multi-layer windows anchor their per-layer records with
# `1f | 0x40` instead (Fixed Lambdas SI Graph5/Graph6, RockingCurve and
# UnpolPlots Graph3 -- all GT-verified); same record grammar after the anchor.
_ANCHOR_PANEL = bytes.fromhex("0300005f")
_Y_TRANSITION = bytes([0x81, 0x04, 0x06, 0x00, 0x00, 0x01, 0xC3, 0x66])
_STEP_TAG = bytes([0x83, 0x02])
# The byte after _Y_TRANSITION is a *combined* axis-scale field, pinned from
# four single/dual-variable specimens (fig_lin/log toggled Y, fig_linx/logx
# toggled X, fig_xylog toggled both — see tools/origin_trial/generate_specimens*):
#   0x03 -> X-lin, Y-lin      0x04 -> X-log, Y-lin
#   0x0d -> Y-log  (0x0d whether X is lin OR log: the field does NOT encode X
#                   once Y is log — X lives in the separate filler flag there,
#                   see _parse_specimen_record; heuristic only if that is
#                   unrecognized too). Y-scale is always exact (0x0d == log).
_TYPE_LOG = 0x0D  # Y log (X unencoded)
_TYPE_LIN = 0x03  # both linear
_TYPE_XLOG = 0x04  # X log, Y linear
_BKNAME_RE = re.compile(rb"<BKNAME>([^<]+)</BKNAME>")
_TEXT_WINDOW = 20_000  # bytes scanned per layer for legend/annotation/source-hint text

# A graph window embeds a PNG preview thumbnail; `_texts_in` decodes its image
# bytes as spurious "text". These chunk names open (or lead) that binary blob, so
# they mark where real annotation text ends — everything at/after is image junk.
_PNG_MARKERS = (
    "IHDR", "IDAT", "IEND", "PLTE", "pHYs", "tEXt",
    "zTXt", "iTXt", "sRGB", "gAMA", "cHRM", "bKGD",
)


def _clean_annotations(titles: list[str]) -> list[str]:
    """Drop non-title noise from a layer's recovered text.

    Two kinds of junk pollute the raw scan: (1) the embedded-PNG thumbnail's image
    bytes decoded as text, and (2) internal Origin storage/style markers. Truncate
    at the first PNG chunk marker (image bytes are a contiguous trailing blob) --
    a concern ``.opj`` doesn't have, so this truncation stays local -- then drop
    internal markers and bare sheet references via ``figures.py``'s shared
    ``_clean_annotations`` (``.opj``'s own scan needs the exact same internal-
    marker filter, see its module docstring's 2026-07-05 note; imported here as
    ``_drop_internal_noise`` rather than duplicated). What remains is the real
    graph title(s) — so a figure labels as e.g. "dR/dB", not "SYSTEM".
    """
    truncated: list[str] = []
    for t in titles:
        if any(t.strip().startswith(m) for m in _PNG_MARKERS):
            break  # PNG image data begins here; the rest of the list is binary junk
        truncated.append(t)
    return _drop_internal_noise(truncated)

# ── specimen-form value spans (item 14) ───────────────────────────────────────


def _value_candidates(b: bytes, pos: int, end: int) -> list[tuple[float, int]]:
    """Every plausible ``(value, bytes_consumed)`` parse starting at ``pos``.

    The bare (no-tag) raw8 shape is rejected when ``pos`` itself starts with a
    byte in the real-form flag-token range ``0x81..0x8f`` (mirroring
    ``_real_bare8``'s identical guard): a genuine specimen-form literal never
    starts there, but a real-form flag token (e.g. ``89 01`` before an
    RLE-compressed value) does, and would otherwise misdecode as a plausible-
    looking bare double -- the false positive that made the rf_* oracle
    quad's linear-X records (whose 8 leading bytes are flag+RLE, not a
    literal) parse via the specimen path with a wrong ``x_from`` and a
    type-byte reading that (unlike the true real-form flag, see
    ``_real_y_log_flag``) carries no Y information at all."""
    avail = end - pos
    out: list[tuple[float, int]] = []
    if avail >= 8 and not (pos < end and 0x81 <= b[pos] <= 0x8F):
        v = _decode_raw8(b[pos : pos + 8])
        if v is not None:
            out.append((v, 8))
    if avail >= 10:
        v = _decode_raw8(b[pos + 2 : pos + 10])
        if v is not None:
            out.append((v, 10))
    for k in (1, 2, 3):
        if avail >= 2 + k:
            v = _decode_compact(b[pos + 2 : pos + 2 + k])
            if v is not None:
                out.append((v, 2 + k))
    return out


def _parse_pair(b: bytes, pos: int, end: int) -> tuple[float, float] | None:
    """Decode ``(from, to)`` from the byte span ``[pos, end)``, or ``None``.

    See the module docstring: every admissible split (``from`` elided, or
    ``from``+``to`` both present) is tried; accepted only if exactly one split
    consumes the span exactly with two plausible values.
    """
    candidates: set[tuple[float, float]] = set()
    for v, n in _value_candidates(b, pos, end):  # from elided (== 0.0): one token = "to"
        if pos + n == end:
            candidates.add((0.0, v))
    for vf, nf in _value_candidates(b, pos, end):  # from present, then to
        p2 = pos + nf
        for vt, nt in _value_candidates(b, p2, end):
            if p2 + nt == end:
                candidates.add((vf, vt))
    return candidates.pop() if len(candidates) == 1 else None


# Real-corpus-form (item 33) value tokens, span decoding, and the Y-scale
# flag live in ``opju_axis_real_form.py`` (kept out of this file to stay under
# the repo's 500-line god-module ceiling) — ``_parse_real_record`` imported
# above is the entry point used below.


# ── shared helpers ────────────────────────────────────────────────────────────


def _find_all(b: bytes, pat: bytes) -> list[int]:
    out = []
    i = b.find(pat)
    while i >= 0:
        out.append(i)
        i = b.find(pat, i + 1)
    return out


def _source_hint(b: bytes, anchor: int) -> str:
    m = _BKNAME_RE.search(b, anchor, min(len(b), anchor + _TEXT_WINDOW))
    return m.group(1).decode("latin1", errors="replace") if m else ""


def _parse_specimen_record(
    b: bytes, p: int
) -> tuple[float, float, float, float, int, bool | None] | None:
    """Specimen-form axis record at anchor payload ``p``:
    ``(xf, xt, yf, yt, type_byte, x_log)``.

    ``x_log`` is the exact X-scale flag inside the "filler" after the type
    byte -- really ``7b 40`` + ``01`` (linear) / ``08 01`` (log10), the same
    field the real form carries (see the module docstring); ``None`` keeps
    the type-byte/heuristic path. ``y_start`` stays at the historical +3
    skip: a log X's extra ``08`` byte is absorbed by ``_parse_pair``'s
    2-byte tag-skip candidate, byte-identically to before."""
    ytrans = b.find(_Y_TRANSITION, p, min(len(b), p + _TAG_SEARCH_SPAN))
    if ytrans < 0:
        return None
    xstep = b.rfind(_STEP_TAG, p, ytrans)
    if xstep < 0:
        return None
    xpair = _parse_pair(b, p, xstep)
    if xpair is None:
        return None
    if ytrans + len(_Y_TRANSITION) >= len(b):  # marker at EOF — no type byte to read
        return None
    tb = ytrans + len(_Y_TRANSITION)
    type_byte = b[tb]
    x_log: bool | None = None
    if b[tb + 1 : tb + 4] == b"\x7b\x40\x01":
        x_log = False
    elif b[tb + 1 : tb + 5] == b"\x7b\x40\x08\x01":
        x_log = True
    y_start = tb + 1 + 3  # + type byte + "7b 40 ..." filler (see docstring)
    ystep = b.find(_STEP_TAG, y_start, min(len(b), y_start + _TAG_SEARCH_SPAN))
    if ystep < 0:
        return None
    ypair = _parse_pair(b, y_start, ystep)
    if ypair is None:
        return None
    return (*xpair, *ypair, type_byte, x_log)


def _scale_byte(b: bytes, p: int, end: int) -> int | None:
    """The combined axis-scale byte after ``_Y_TRANSITION`` near anchor ``p``.

    Returns ``None`` when the marker is absent (every real-corpus figure
    anchor, whose scale is heuristic-only) so those layers stay untouched.
    """
    yt = b.find(_Y_TRANSITION, p, min(end, p + _TAG_SEARCH_SPAN))
    if yt < 0 or yt + len(_Y_TRANSITION) >= len(b):
        return None
    return b[yt + len(_Y_TRANSITION)]


def _axis_scales(
    type_byte: int, x_from: float, x_to: float, y_from: float, y_to: float
) -> tuple[bool, bool]:
    """``(x_log, y_log)`` from the combined scale byte (see ``_TYPE_*`` notes).

    Y-scale is exact for every observed byte; X-scale is exact only when the
    byte isolates it (``0x04``) and otherwise honestly falls back to the
    decade heuristic — the byte carries no X information once Y is log.
    """
    if type_byte == _TYPE_LIN:  # 0x03: both linear
        return False, False
    if type_byte == _TYPE_XLOG:  # 0x04: X log, Y linear
        return True, False
    if type_byte == _TYPE_LOG:  # 0x0d: Y log; X not encoded -> heuristic
        return _log_heuristic(x_from, x_to), True
    # unrecognized flag: no isolated evidence, heuristic for both (like .opj)
    return _log_heuristic(x_from, x_to), _log_heuristic(y_from, y_to)


def extract_figures_opju(b: bytes) -> list[dict[str, Any]]:
    """Every decodable graph layer in a CPYUA project as a plot-state snapshot.

    Same shape as ``figures.extract_figures`` (the ``.opj`` reader): each
    dict has ``name``, ``layer``, ``x_from``, ``x_to``, ``x_log``,
    ``y_from``, ``y_to``, ``y_log``, ``source_hint``, ``n_curves``,
    ``annotations``, and ``curves`` (a list of ``{"book", "x", "y"}``
    column bindings, possibly empty — decoded via the global column-id
    table, see ``opju_figure_curves.py`` and the module docstring's
    "Curve-to-dataset binding" section). ``name`` is the figure's own
    window name (``"Graph1"`` …) when its anchor falls inside a graph
    *page* span and the file carries an id table; ``layer`` is then the
    1-based anchor index within that page. Embedded fit-report graphs
    (anchors inside a workbook page) and legacy/id-table-less streams keep
    ``name == ""``/``layer == 1``. A multi-layer graph window (e.g. a
    double-Y or free-panel layout) yields one dict per layer rather than
    nesting them, since the shipped payload shape is flat. Composite
    windows that *reference* an already-encoded layer share its single
    anchor (see the module docstring).

    ``x_title``/``y_title``/``y2_title``/``legend_labels``/``annotations``
    are routed per named graph-child object (``YL``/``XB``/``YR``/``Legend``/
    ``Text*`` — the same object names and bucket table as ``.opj``) via
    CPYUA's own name-header + framed-text grammar, solved 2026-07-05: see
    ``opju_figure_text.py``'s module docstring for the byte-level framing
    and the hc2convert.opj cross-container validation. Windows with no
    framed text objects at all (legacy/synthetic streams) degrade to the
    historical flat-scrape ``annotations`` with empty titles/legend.
    """
    figures: list[dict[str, Any]] = []
    pages = opju_pages(b)
    table = column_id_table(b, pages)
    legacy = not table.ids  # no id table (synthetic/template stream): counting fallback
    if legacy:
        book_columns = book_columns_from_bytes(b)
        books_meta = book_metadata_from_bytes(b, book_columns)
        book_counts_all = allocated_columns_from_bytes(b)
    page_starts = [off for off, _name in pages]
    page_layers: dict[int, int] = {}  # page index -> layers emitted so far
    anchors = sorted(_find_all(b, _ANCHOR) + _find_all(b, _ANCHOR_PANEL))
    for idx, anchor in enumerate(anchors):
        p = anchor + len(_ANCHOR)
        next_anchor = anchors[idx + 1] if idx + 1 < len(anchors) else len(b)
        # Scope the window by the containing page span (see opju_figure_curves):
        # an anchor's curves/axis record never extend past its own page.
        page_idx = bisect_right(page_starts, anchor) - 1
        if page_idx >= 0:
            page_end = page_starts[page_idx + 1] if page_idx + 1 < len(pages) else len(b)
            page_name = pages[page_idx][1]
        else:
            page_end, page_name = len(b), None
        window_end = min(next_anchor, page_end)
        spec = _parse_specimen_record(b, p)
        type_byte: int | None
        real_y_log: bool | None = None
        x_flag: bool | None
        if spec is not None:
            x_from, x_to, y_from, y_to, type_byte, x_flag = spec
        else:
            real = _parse_real_record(b, p, window_end)
            if real is None:
                continue  # undecodable record: skip, never guess
            x_from, x_to, y_from, y_to, x_flag, real_y_log = real
            # the full specimen record may not parse (e.g. an X-log record's
            # varying filler) yet still carry the scale marker — read it directly
            type_byte = _scale_byte(b, p, window_end)
        if type_byte is None:  # real-corpus form: no marker, heuristic for X
            x_log = _log_heuristic(x_from, x_to)
            y_log = _log_heuristic(y_from, y_to)
        else:
            x_log, y_log = _axis_scales(type_byte, x_from, x_to, y_from, y_to)
        if x_flag is not None:
            # the exact X-scale flag (both forms carry it right before the Y
            # span, see _real_x_log_flag) wins over type byte and heuristic.
            x_log = x_flag
        if real_y_log is not None:
            # the real-form Y-scale flag (_real_y_log_flag) is exact and
            # always wins: type_byte's 0x03/0x04 pair only ever isolates X in
            # this form (see the module docstring), so it must never override
            # a real Y reading with a stale/heuristic one.
            y_log = real_y_log
        text_end = min(window_end, anchor + _TEXT_WINDOW)
        window = b[anchor:text_end]
        texts = _texts_in(window)
        titles = _clean_annotations(
            [t for t in texts if not _AUTO_TITLE.match(t) and "\\l(" not in t]
        )
        legend_ns = [int(n) for t in texts for n in _LEGEND_RE.findall(t)]
        routed = routed_figure_text(
            b, anchor, text_end, (x_from, x_to, y_from, y_to), x_log, y_log
        )
        # A page that owns no column records is a GRAPH page: its figures get
        # the page's own window name ("Graph1", ...) and a real 1-based layer
        # index within the page. Anchors inside a workbook/report page are
        # embedded (fit-report) graphs -- unnamed, layer 1, as before. Name
        # attachment needs the id table (it is what tells book pages apart),
        # so legacy streams keep the historical ""/1.
        if not legacy and page_name is not None and page_name not in table.book_pages:
            layer = page_layers.get(page_idx, 0) + 1
            page_layers[page_idx] = layer
            name = page_name
        else:
            name, layer = "", 1
        if legacy:
            curves = extract_curves(
                b, anchor, window_end, book_columns, books_meta, book_counts_all
            )
        else:
            curves = extract_curves_by_id(b, anchor, window_end, table)
        figures.append(
            {
                "name": name,
                "layer": layer,
                "x_from": x_from,
                "x_to": x_to,
                "x_log": x_log,
                "y_from": y_from,
                "y_to": y_to,
                "y_log": y_log,
                "source_hint": _source_hint(b, anchor),
                "n_curves": max(legend_ns) if legend_ns else 0,
                # Routed per named text object when the window carries CPYUA's
                # framed text grammar (opju_figure_text); flat-scrape degrade
                # (the historical behavior) otherwise.
                "annotations": routed.annotations if routed else titles[:12],
                # Positioned floating text (box top-left, data coords) — only
                # objects whose fixed-distance position field decoded (see
                # annotation_marks.py); the rest stay text-only above.
                "annotation_marks": routed.annotation_marks if routed else [],
                "x_title": routed.x_title if routed else "",
                "y_title": routed.y_title if routed else "",
                "y2_title": routed.y2_title if routed else "",
                "legend_labels": routed.legend_labels if routed else [],
                # Legend box top-left in data coords, or None (never guessed).
                "legend_pos": routed.legend_pos if routed else None,
                "curves": curves,
            }
        )
    return figures
