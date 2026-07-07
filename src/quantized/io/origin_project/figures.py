"""Extract figure definitions from ``.opj`` graph windows (plan items 12/13).

Per ``docs/origin_re/opj_figures.md``: a graph window = a header block
(``00 00 <Name> 00`` + template token) followed by a layer-continuation block
(head ``00 00 1f 00``) holding the axis ranges as float64 ``(from, to, step)``
triples at offsets 15/23/31 (X) and 58/66/74 (Y), then typed child objects —
legend text (``\\l(n) %(n)`` per curve), axis titles, and text annotations.

**Y-axis scale flag — solved 2026-07-04** (the "real form scale bit" item):
the 2 bytes at payload offsets 98/99 are an exact Y lin/log flag, ``01 00``
= linear, ``08 01`` = log10 — the same two byte values (in the same order)
as the independently-discovered ``.opju`` real-corpus-form flag
(``figures_opju.py``'s ``_real_y_log_flag``), just at a different fixed
offset in this container's layer-continuation block. Isolated by
byte-diffing XRD's single log-Y ``Graph1`` layer against all 15 recovered
linear-Y layers in ``Moke.opj`` (identical at every byte except 98/99 and a
second, unrelated candidate at 189 that a wider corpus scan ruled out — see
``docs/origin_project_format.md`` §6.1) and validated against >300 further
layers across PNR/MnN_Diffusion_PNR/XMCD/hc2convert/SuperlatticeFits: only
these two byte values ever occur, and several instances (reflectivity R(Q)
curves zoomed to a sub-decade log range, e.g. Y=(0.9772, 1.2916)) are flag
log but heuristic-linear — cases the flag resolves correctly where the old
decade heuristic could not. **X stays heuristic-only in this container**:
``.opju`` grew an exact X flag on 2026-07-06 (the same ``01``/``08 01``
byte values, see ``opju_axis_real_form._real_x_log_flag``), but no ``.opj``
log-x oracle exists to isolate an ``.opj`` twin — the corpus is all-linear
in X and the trial Origin only writes CPYUA (a ``.opj`` save silently
becomes ``.opju``), so a candidate offset near 98/99 cannot be told apart
from constants. Honest boundary: heuristic, never guessed. See
``docs/origin_re/ORIGIN_CONVENTIONS.md`` §6.2.

The recoverable content is the plot-state snapshot the owner asked for: axis
ranges, an exact Y-scale flag (falling back to the decade heuristic only
when the flag byte pair is unrecognized), an X-scale decade heuristic (a
positive axis spanning ≥ 3 decades reads as log — no isolated X flag found),
titles/annotations, the curve count, and — **solved 2026-07-04, item 11** —
an exact per-curve ``{book, x, y}`` column binding (the ``"curves"`` field,
same shape as ``.opju``'s). See ``opj_curves.py``'s module docstring for the
full byte-level trail: every curve carries a small "anchor" record right
before its DataPlot style+body pair, holding the plotted column's own
global, project-wide serial id (independently confirmed against each
column's own storage block in the windows section) — book and column are
both resolved by this one id; X is a structural inference (the book's own
designated-X column), unverified against any oracle, exactly like
``.opju``. Figures still also carry the looser ``source_hint`` (the layer's
source book display name) for cases the per-curve binding can't reach.

**One dict PER LAYER — solved 2026-07-04.** A graph window is one figure to
Origin's user but can hold several **layers** — independent axis systems
with their own curves, overlaid in the same window (double-Y plots, or
composite/"panel" windows that union several source graphs' layers, e.g.
Moke's ``Graph10`` = ``Graph7``'s two layers + ``Graph4``'s two layers).
Each layer gets its own **layer-continuation block** (head ``00 00 1f 00``,
the axis-range record described below) and these repeat, one per layer,
positionally in the block stream — the first right after the window
header, each next one immediately following the previous layer's own
child objects (axis titles, legend, curves). `extract_figures` now walks
every layer-continuation block found inside a window's span (from its
header to the next window header, of either kind) and emits one figure
dict per layer, identical in shape to before plus a new 1-based ``"layer"``
key; ``"name"`` repeats the window name across all its layers' dicts.
**Curve attribution is positional**: every curve anchor (see
``opj_curves.py``) between one layer-continuation block and the next
belongs to that layer — validated exactly (both curve count and the exact
per-layer ``(book, column)`` sets) against Moke's ``Graph4`` (2 layers, 2
curves each), ``Graph7`` (2 layers, 3 curves each), and ``Graph10`` (4
layers, the literal union of ``Graph7``'s + ``Graph4``'s, 3/3/2/2 curves) —
see §6.1 for the full trail. Single-layer windows are unaffected: they get
exactly one figure dict, ``"layer": 1``, byte-identical to the pre-split
decode.

**Axis-title / legend-label routing — solved 2026-07-05.** Every graph-child
object (axis title, legend, floating annotation) is a **133-byte header**
(the same one counted for curves, ``payload[2] == 0x07``) followed by a
fixed-size "format" block (no text) and then a content block holding the
object's actual text — see the containment example above. The header block
carries the object's own name as a plain NUL-terminated ASCII cstring at a
**fixed payload offset, 70** (``_OBJ_NAME_OFFSET``) — confirmed corpus-wide
(XRD/Moke/SuperlatticeFits/PNR/hc2convert/XMCD/MnN_Diffusion_PNR, several
hundred header blocks) via ``_cstring(payload, 70, 24)``: axis-title objects
are named ``YL``/``XB``/``YR``/``XT`` (Y-left, X-bottom, Y-right/secondary,
X-top), the legend object is always named ``Legend``, floating textbox/line
annotations are ``Text``/``TextN``/``Line``/``LineN``, and everything else
(``__LayerInfoStorage``/``__BCO2``/``__FRAMESRCDATAINFOS``/``3D`` — internal
storage/config objects; ``OB``/``OL``/``OR``/``X1``/``X2`` — composite-layout
axis-break sub-objects seen only in double-Y/stacked graphs; ``Rect*``/
``Circle*`` — box/region shapes; ``RLX*``/``RLY*`` — reference lines) is a
different, unrelated object, not routed anywhere.

``_build_layer`` now tracks which named object is "current" while walking a
layer's block span and routes each recovered text run accordingly: ``YL`` →
``y_title``, ``XB`` → ``x_title``, ``YR`` → ``y2_title``, ``Legend`` →
``legend_labels`` (parsed per curve from the ``\\l(n) <label>`` lines — kept
verbatim whether hand-edited literal text, e.g. hc2convert's ``Nb``/``Nb/Al``/
``Nb/Au``, or the untouched auto template ``%(2)``), ``Text*``/``Line*`` →
``annotations`` (genuine floating text only, now cleaned of internal
storage/style noise the same way ``figures_opju.py``'s ``_clean_annotations``
already protected ``.opju`` — ported here since ``.opj``'s own scan had no
such filter, letting an internal ``OriginStorage``/``AxesDlgSettings`` XML
blob leak into ``XMCD.opj``'s ``Graph3``/``Co-Fy`` annotations). Every other
named or unresolved header switches the current bucket to "ignore" (dropped,
never guessed) — including a curve header itself, so a curve's own style/
DataPlot body never inherits the previous object's bucket. Before the first
header in a layer (or if no header ever resolves), the bucket defaults to
``annotations`` — the same fallback the old flat scrape gave, so a
layer this scan can't structure at all degrades to the pre-2026-07-05
behavior instead of losing text. Validated against XRD.opj (``YL``→
"Intensity (arb. units)", ``XB``→ the escaped 2θ string, ``Legend``→
``["%(2)", "325", "525"]`` — two curves hand-relabeled to sample
temperatures) and hc2convert.opj (``Legend``→ ``["Nb", "Nb/Al", "Nb/Au"]``,
fully hand-edited; a genuine trailing ``Text`` annotation, "Field applied
in-plane"/"T = 1.3 K", correctly still lands in ``annotations`` even though
it sits after the layer's curve blocks, because the ``Text`` header itself
re-establishes the bucket).

**Positioned annotation marks — solved 2026-07-05.** A ``Text*``/``Line*``
object's 133-byte header also stores its box's top-left corner as two LE
float64 layer-fractions at payload offsets **19/27**, converted to data
coordinates via the layer axis range and shipped as ``annotation_marks``
(one entry per text OBJECT, multi-line text ``\\n``-joined) — decode,
formula, oracle validation and known negatives in ``annotation_marks.py``.

``.opju`` (``figures_opju.py``) routes to the same buckets through its own,
different framing (solved 2026-07-05): CPYUA has no 133-byte header, but it
carries the SAME object names in a tagged name-header + framed-text grammar
— see ``opju_figure_text.py``'s module docstring for the byte layout and
the cross-container validation (every state-matched graph shared between
``Hc2 data.opju`` and ``hc2convert.opj`` routes to identical titles). That
module reuses ``_object_bucket``/``_first_title``/``_parse_legend_labels``/
``_clean_annotations`` from here so the two containers' cleanup pipelines
cannot drift.
"""

from __future__ import annotations

import struct
from typing import Any

from quantized.io.origin_project.annotation_marks import (
    _AUTO_TITLE,
    _clean_annotations,
    build_mark,
    frac_to_data,
    opj_object_box,
    opj_text_fractions,
    page_point_fractions,
)
from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.figure_geometry import opj_layer_frame, opj_page_size
from quantized.io.origin_project.figure_text import (
    _LEGEND_RE,
    _first_title,
    _object_bucket,
    _object_text,
    _parse_legend_labels,
    _texts_in,
)
from quantized.io.origin_project.opj_curves import book_x_columns, column_id_map, extract_curves
from quantized.io.origin_project.origin_richtext import clean_richtext
from quantized.io.origin_project.windows import _cstring, _is_window_header

__all__ = ["extract_figures"]

# Fixed payload offset of a 133-byte object header's own ASCII name (see
# module docstring). 24 bytes is ample for every name observed corpus-wide
# (the longest, "__FRAMESRCDATAINFOS", is 19 chars).
_OBJ_NAME_OFFSET = 70
_OBJ_NAME_LIMIT = 24

# Y-axis scale flag: 2 bytes at the layer-continuation payload's offset 98/99
# (see the module docstring). Any other value falls back to the heuristic.
_Y_SCALE_FLAG_OFFSET = 98
_Y_LIN_FLAG = bytes([0x01, 0x00])
_Y_LOG_FLAG = bytes([0x08, 0x01])


def _axis(p: bytes, base: int) -> tuple[float, float]:
    lo, hi = struct.unpack_from("<d", p, base)[0], struct.unpack_from("<d", p, base + 8)[0]
    return float(lo), float(hi)


def _log_heuristic(lo: float, hi: float) -> bool:
    return lo > 0 and hi > 0 and hi / lo >= 1000.0


def _y_scale_flag(payload: bytes) -> bool | None:
    """Exact Y lin/log flag from the layer-continuation payload, or ``None``
    when the block is too short or the byte pair is unrecognized (caller
    falls back to ``_log_heuristic``) -- see the module docstring."""
    if len(payload) < _Y_SCALE_FLAG_OFFSET + 2:
        return None
    flag = payload[_Y_SCALE_FLAG_OFFSET : _Y_SCALE_FLAG_OFFSET + 2]
    if flag == _Y_LIN_FLAG:
        return False
    if flag == _Y_LOG_FLAG:
        return True
    return None


# A layer-continuation block's 3rd payload byte -- normally 0x1f (every
# window's first layer, and every subsequent OVERLAID layer, e.g. a
# double-Y graph's 2nd layer: validated on Moke's Graph7 AND on
# SLD_DoubleY.otp's two-layer double-Y template, both 0x1f/0x1f). A second,
# rarer value, 0x1f - 0x08 = 0x17, appears ONLY as a subsequent STACKED/
# TILED-PANEL layer (Origin's "N Panels" layout, a structurally different
# multi-layer mechanism from double-Y overlay) -- isolated on Moke's Graph4
# (layers 0x1f then 0x17, second layer's axis range (400.0, 1500.0) matches
# the oracle's 2nd-layer Y range exactly) and its composite copy inside
# Graph10. Corpus-wide grep (Moke/XRD/SuperlatticeFits/PNR/hc2convert/XMCD/
# MnN_Diffusion_PNR) finds 0x17 nowhere else at all -- and never outside a
# graph window's own span -- so accepting it is not a guess, it is confirmed
# structural evidence, not (yet) a generalized "any byte works" heuristic:
# only these two exact values are recognized; anything else falls through
# and is not treated as a layer boundary.
_LAYER_HEAD_BYTES = (0x1F, 0x17)


def _is_layer_block(payload: bytes) -> bool:
    """A layer-continuation block: head ``00 00 <0x1f|0x17> 00``, ≥90 B (the
    axis-range triples' fixed offsets need at least that much). Graph windows
    repeat this block once per layer (see module docstring); this same
    detector both identifies a window header as a *graph* header (checked
    against the block right after it -- always the first layer, always
    0x1f) and finds every subsequent layer boundary inside one (0x1f or the
    rarer 0x17 -- see ``_LAYER_HEAD_BYTES``)."""
    return (
        len(payload) >= 90
        and payload[0] == 0
        and payload[1] == 0
        and payload[2] in _LAYER_HEAD_BYTES
        and payload[3] == 0
    )



def _build_layer(
    blocks: list[tuple[int, bytes]],
    id_map: dict[int, tuple[str, str]],
    x_columns: dict[str, str],
    name: str,
    layer_no: int,
    start: int,
    end: int,
) -> dict[str, Any]:
    """One layer's plot-state dict: axis ranges from its own
    layer-continuation block (``blocks[start]``); curves/curve-count/
    annotations/titles/legend scoped to the half-open ``blocks[start:end)``
    -- exactly this layer's own content, since layer records, curve anchors,
    and graph-child objects are sequential within a window span (module
    docstring; validated against Moke's Graph4/Graph7/Graph10).

    Text routing (2026-07-05): walks the block span tracking which named
    object is "current" (``_object_bucket``) and files each block's
    recovered text into that bucket -- ``x_title``/``y_title``/``y2_title``
    (single string), ``legend`` (raw ``\\l(n)`` lines, parsed after the loop),
    or ``annotations`` (floating text, cleaned of internal-storage noise).
    The bucket starts as ``"annotations"`` (so text preceding the first
    header, or an entire layer with no resolvable header at all, degrades to
    the pre-2026-07-05 flat scrape rather than losing text). A curve header
    (``payload[2] == 0x07``) only increments ``n_curves``, exactly as
    before -- it does NOT change the current bucket, since a real curve's
    own style/DataPlot body never produces recognizable text anyway (every
    instance checked corpus-wide already scans to ``[]``) and a curve
    template can legitimately sit *between* two objects that share one
    bucket (e.g. a layer's fixed 2-curve template between ``Legend`` and a
    later ``Text`` annotation). Any OTHER named or unresolved header does
    switch the bucket, including to ``"ignore"`` for uninteresting objects.
    """
    layer_payload = blocks[start][1]
    x_from, x_to = _axis(layer_payload, 15)
    y_from, y_to = _axis(layer_payload, 58)
    hint = _cstring(layer_payload, 208, 24) or ""
    y_log = _y_scale_flag(layer_payload)
    # Final scale flags, needed up-front: positions (annotation marks, the
    # legend box) interpolate in log10 space on log axes (annotation_marks).
    x_log = _log_heuristic(x_from, x_to)  # no isolated X flag found in .opj
    y_log_final = y_log if y_log is not None else _log_heuristic(y_from, y_to)
    frame = opj_layer_frame(layer_payload)
    n_curves = 0
    all_texts: list[str] = []  # every recognized text run -- feeds legend_ns/n_curves as before
    bucket_texts: dict[str, list[str]] = {
        "x_title": [],
        "y_title": [],
        "y2_title": [],
        "legend": [],
        "annotations": [],
    }
    bucket = "annotations"  # default until a named header switches it (see docstring)
    # Positioned annotation marks: one per Text*/Line* OBJECT, its fraction
    # pair read from the header payload (annotation_marks.py) and its lines
    # grouped until the next named header — multi-line text stays ONE mark.
    marks: list[dict[str, Any]] = []
    mark_fracs: tuple[float, float] | None = None
    mark_lines: list[str] = []
    mark_active = False  # only text owned by a named Text*/Line* header groups
    # The Legend object's own header carries the SAME position fields
    # every text object does (§13.2 #3, 2026-07-06) — box top-left.
    legend_fracs: tuple[float, float] | None = None

    def _object_fractions(payload: bytes) -> tuple[float, float] | None:
        """Anchor fractions for one object header (solved 2026-07-06 vs the
        111-instance annotations oracle). Two independent position fields
        exist: the FRACTION pair (the text anchor -- exact for every
        unrotated object, bordered or not) and the page-unit bounding BOX
        (post-rotation geometry). For a 90-degree-rotated label the fraction
        pair stores only the PRE-rotation anchor, which lands at exactly
        ``(+d, -d)`` page units from the box's bottom-left -- the signature
        of rotation about the first character's baseline point (d = the font
        ascent; measured equal-magnitude on every rotated corpus instance,
        XRD's 46 peak labels). A bordered horizontal label's anchor sits at
        ``(+inset, -boxheight+inset)`` instead -- never the equal-magnitude
        diagonal -- so the test is geometric, not a corpus threshold.
        Rotated: anchor at the box bottom-left (the text-start corner Origin
        itself reports); everything else: the fraction pair (the
        pre-2026-07-06 behaviour, still exact for those)."""
        fracs = opj_text_fractions(payload)
        if frame is None or fracs is None:
            return fracs
        box = opj_object_box(payload)
        if box is None:
            return fracs
        fl, ft, fr, fb = frame
        anchor_x = fl + fracs[0] * (fr - fl)
        anchor_y = ft + fracs[1] * (fb - ft)
        dx = anchor_x - box[0]
        dy = anchor_y - box[3]
        if dx > 0 > dy and abs(dx + dy) <= 0.25 * dx:
            return page_point_fractions(box[0], box[3], frame)
        return fracs

    def _flush_mark() -> None:
        nonlocal mark_fracs
        mark = build_mark(
            mark_fracs, mark_lines, x_from, x_to, y_from, y_to, x_log, y_log_final
        )
        if mark is not None:
            marks.append(mark)
        mark_fracs = None
        mark_lines.clear()

    for k in range(start + 1, end):
        size, payload = blocks[k]
        if size == 133 and len(payload) > 2 and payload[2] == 0x07:
            n_curves += 1  # the curve counter only -- does not touch `bucket` (see docstring)
            continue
        if size == 133 and len(payload) > 2:
            bucket = _object_bucket(_cstring(payload, _OBJ_NAME_OFFSET, _OBJ_NAME_LIMIT))
            _flush_mark()
            mark_active = bucket == "annotations"
            if mark_active:
                mark_fracs = _object_fractions(payload)
            if bucket == "legend" and legend_fracs is None:
                legend_fracs = _object_fractions(payload)
            # Never text-scan the header block itself: its geometry floats can
            # contain printable accidents that would land in the just-set
            # bucket (hc2convert's Graph13-18 all surfaced a bogus y_title
            # "TEP]" from 4 printable bytes inside the YL header's own
            # position doubles). Real object text lives in the CONTENT block
            # that follows, never in the header.
            continue
        if size < 1200 and not _is_layer_block(payload):
            # A block OWNED by a Text/Line annotation header that is exactly
            # a NUL-terminated string is the object's verbatim text -- exact,
            # no noise heuristics (they drop 'X'/'*'/'Si' peak labels). Split
            # per line so the flat annotations bucket keeps the same per-line
            # shape both containers use (marks re-join with newline anyway).
            exact = _object_text(payload) if mark_active else None
            if exact is not None:
                found = [line for line in exact.split("\n") if line.strip()]
            else:
                found = _texts_in(payload)
            all_texts.extend(found)
            if bucket in bucket_texts:
                bucket_texts[bucket].extend(found)
            if mark_active:
                mark_lines.extend(found)
    _flush_mark()
    titles = [
        t for t in bucket_texts["annotations"] if not _AUTO_TITLE.match(t) and "\\l(" not in t
    ]
    legend_ns = [int(n) for t in all_texts for n in _LEGEND_RE.findall(t)]
    return {
        "name": name,
        "layer": layer_no,
        "x_from": x_from,
        "x_to": x_to,
        "x_log": x_log,
        "y_from": y_from,
        "y_to": y_to,
        "y_log": y_log_final,
        # The layer frame rect in page units (multi-panel layout, §13.2 #7);
        # None when the quad is missing/degenerate.
        "frame": (
            dict(zip(("left", "top", "right", "bottom"), frame, strict=True))
            if frame is not None
            else None
        ),
        "source_hint": hint,
        "n_curves": max(legend_ns) if legend_ns else n_curves,
        "annotations": [clean_richtext(a) for a in _clean_annotations(titles)[:12]],
        # Positioned floating text (box top-left, data coords) — only objects
        # whose header fractions decoded; the rest stay text-only above.
        "annotation_marks": marks,
        "x_title": _first_title(bucket_texts["x_title"]),
        "y_title": _first_title(bucket_texts["y_title"]),
        "y2_title": _first_title(bucket_texts["y2_title"]),
        "legend_labels": _parse_legend_labels(bucket_texts["legend"]),
        # Legend box top-left in data coords, or None (never guessed).
        "legend_pos": (
            dict(
                zip(
                    ("x", "y"),
                    frac_to_data(
                        *legend_fracs, x_from, x_to, y_from, y_to, x_log, y_log_final
                    ),
                    strict=True,
                )
            )
            if legend_fracs is not None
            else None
        ),
        # item 2: curves attributed positionally to THIS layer only.
        "curves": extract_curves(blocks, start, end, id_map, x_columns),
    }


def extract_figures(b: bytes) -> list[dict[str, Any]]:
    """Every layer of every graph window in a CPYA project as a plot-state
    snapshot dict -- one dict per layer (see module docstring)."""
    blocks = [(size, payload) for size, payload in walk_blocks(b) if size]
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    figures: list[dict[str, Any]] = []

    n = len(blocks)
    i = 0
    while i < n:
        name = _is_window_header(blocks[i][1])
        if name is None:
            i += 1
            continue
        nxt = blocks[i + 1][1] if i + 1 < n else b""
        if not _is_layer_block(nxt):
            i += 1  # a worksheet (or other non-graph) window: not a figure
            continue
        # A GRAPH window: its span runs to the next window header of either
        # kind (graph or worksheet), or EOF.
        j = i + 2
        while j < n and _is_window_header(blocks[j][1]) is None:
            j += 1
        win_end = j
        layer_starts = [k for k in range(i + 1, win_end) if _is_layer_block(blocks[k][1])]
        page = opj_page_size(blocks[i][1])
        for pos, layer_start in enumerate(layer_starts):
            layer_end = layer_starts[pos + 1] if pos + 1 < len(layer_starts) else win_end
            fig = _build_layer(blocks, id_map, x_columns, name, pos + 1, layer_start, layer_end)
            # Page size (u16 pair @35 of the window header): with the layer
            # frame quad this places every panel of a multi-panel page.
            fig["page"] = page
            figures.append(fig)
        i = win_end
    return figures
