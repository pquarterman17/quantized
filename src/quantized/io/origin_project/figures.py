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
X-top), the legend object is named ``Legend`` — or lowercase ``legend`` on
every composite/multi-layer window in the corpus, matched case-insensitively
since 2026-07-11 (item 41) — floating textbox/line annotations are
``Text``/``TextN``/``Line``/``LineN``, region-shape objects are ``Rect*``
(their typed headers, ``payload[2] == 0x31``, are decoded into
``region_shades`` by ``opj_shapes.py`` — item 41 — before name routing
runs), and everything else
(``__LayerInfoStorage``/``__BCO2``/``__FRAMESRCDATAINFOS``/``3D`` — internal
storage/config objects; ``OB``/``OL``/``OR``/``X1``/``X2`` — composite-layout
axis-break sub-objects seen only in double-Y/stacked graphs;
``RLX*``/``RLY*`` — reference lines) is a different, unrelated object, not
routed anywhere.

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

**Composite (multi-layer) legends — solved 2026-07-11 (item 41).** A
double-Y/merge window carries ONE legend object (lowercase ``legend`` in
every corpus instance) whose dotted ``\\l(layer.plot)`` entries caption
EVERY layer's curves; ``extract_figures`` distributes them across the
window's layer dicts after building them — grammar, re-indexing rule, and
the never-overwrite guarantee live in
``figure_text.distribute_legend_layers``'s docstring. ``.opju`` needs no
equivalent (corpus-wide sweep: dotted entries occur in no real ``.opju``).

**Module split (2026-07-11, MAIN #8h):** the layer-scoped helpers this
docstring describes — ``_axis``/``_log_heuristic``/``_y_scale_flag``,
``_is_layer_block``/``_LAYER_HEAD_BYTES``, and ``_build_layer`` — moved
verbatim to ``figure_layers.py`` (the 500-line guard); this module keeps
the window walk, ``extract_figures``. The byte-level trail above remains
the authoritative record for both files.
"""

from __future__ import annotations

from typing import Any

from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.figure_geometry import opj_page_size
from quantized.io.origin_project.figure_layers import _build_layer, _is_layer_block
from quantized.io.origin_project.figure_text import distribute_legend_layers
from quantized.io.origin_project.opj_curves import book_x_columns, column_id_map
from quantized.io.origin_project.windows import _is_window_header

__all__ = ["extract_figures"]


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
        window_figs: list[dict[str, Any]] = []
        for pos, layer_start in enumerate(layer_starts):
            layer_end = layer_starts[pos + 1] if pos + 1 < len(layer_starts) else win_end
            fig = _build_layer(blocks, id_map, x_columns, name, pos + 1, layer_start, layer_end)
            # Page size (u16 pair @35 of the window header): with the layer
            # frame quad this places every panel of a multi-panel page.
            fig["page"] = page
            window_figs.append(fig)
        # Composite (multi-layer) legends: dotted ``\l(layer.plot)`` entries
        # live in ONE legend object but caption every layer's curves —
        # distribute them across this window's dicts (item 41).
        distribute_legend_layers(window_figs)
        figures.extend(window_figs)
        i = win_end
    return figures
