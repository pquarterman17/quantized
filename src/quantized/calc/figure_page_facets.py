"""A faceted panel as one figure-page cell (FIGURE_AUTHORING_WORKFLOW_PLAN
F4.4 follow-up, 2026-08-24), split out of ``calc.figure_page`` to keep that
module under its 500-line ceiling (the same reason ``figure_page_layout.py``
/ ``figure_page_panel_labels.py`` / ``figure_page_validate.py`` exist
separately). Replaces the earlier PNG/``imshow`` raster embed (R2, fix round
3): a faceted page panel now draws as a REAL VECTOR sub-grid of matplotlib
Axes inside its cell -- one raster cell is no longer stuck inside an
otherwise-vector PDF/SVG page export.

**Fix round 2 (2026-08-24): rebuilt on ``matplotlib.figure.SubFigure`` for
GRID placement, empirically verified; free (``page_rect``) placement keeps
a hand-rolled fallback because SubFigure demonstrably breaks there.** A
prior round hand-rolled the sub-grid with a raw ``GridSpecFromSubplotSpec``/
bounded ``GridSpec`` plus a same-position invisible "frame axes" carrying
the cell title -- that reproduced 3 rendering bugs, probe-confirmed against
a review pass: (V1) the frame axes' ``set_title`` drew literally on top of
the top-row facet titles (an ordinary Axes has no "reserved space" concept
relative to another independent Axes at the same gridspec slot); (V2)
manually looping ``fig.add_subplot(..., sharex=first)`` does NOT get
matplotlib's automatic interior-tick-label hiding -- that lives inside the
``subplots()`` convenience factory itself, not in ``sharex=`` alone; (V4) a
bounded ``GridSpec`` fills the cell edge-to-edge with the axes' DATA area
(no margin), so tick/axis labels rendered outside the ``page_rect`` (the
raster embed never had this problem -- the image's own baked-in margins
were part of the pixels, confined by ``imshow`` scaling into the rect by
construction).

``SubFigure`` (``fig.add_subfigure``) fixes (V1)/(V2) for grid placement --
calling its own ``.subplots(sharex=True, ...)`` gives EXACT standalone
parity (automatic interior-tick-label hiding), and ``.suptitle`` reserves
real space above the grid instead of drawing over it. **BUT this only works
under ``"constrained"`` layout (fix round 3, W1)** -- a prior round's
"verified across all three layout engines" claim was checked WITHOUT a
``col_gap``/``row_gap``, and was wrong: probed a 1x2 page grid, facet at
(0,0), flat sibling at (0,1), ``col_gap=0.3`` -- under ``"none"``/``"tight"``
the SubFigure's ``bbox_relative`` stayed pinned at ``(0.0, 0.0, 0.5, 1.0)``
IDENTICALLY whether ``col_gap`` was set or not, while the flat sibling's own
position (an ordinary ``add_subplot``) DID shift to honor the gap -- the
facet cell renders oversized/offset relative to its sibling and the
requested gap never appears beside it. Root cause: ``SubFigure.
_redo_transform_rel_fig``'s ratio-only fallback (see the free-placement
paragraph below) ignores a gridspec's ``wspace``/``hspace`` AND its default
rc subplot margins entirely -- an ordinary ``add_subplot`` position comes
from ``GridSpec.get_grid_positions()``, which DOES incorporate both; the
earlier "~0.5 split matches" check happened to hold with NO gap/margins in
play, which masked this.

Given that, grid placement uses SubFigure ONLY when ``resize_mode ==
"constrained"``; ``"tight"``/``"none"`` use a DEFERRED variant of the same
inset-``GridSpec`` fallback free placement uses (``begin_grid_cell_
fallback``/``finish_grid_cell_fallback`` below) -- a throwaway placeholder
``Axes`` stands in at the cell's ``SubplotSpec`` during the page's normal
panel loop (so its EVENTUAL, real ``get_position()`` reflects whatever
``wspace``/margins an ORDINARY panel in that same slot would get -- exactly
the geometry an ordinary sibling panel gets, since it comes from the SAME
``GridSpec.get_grid_positions()`` call), and once every OTHER page panel is
also drawn, one ``fig.canvas.draw()`` settles it, its position is read off,
and it's removed. The "once every OTHER panel is also drawn" ordering
requirement is NOT paranoia -- probed empirically: for ``"none"`` an early
read (before later panels are added) already matches the final one
(identical bounds), but for ``"tight"`` it does NOT -- ``tight_layout``'s
whitespace-trimming pass keeps refining the throwaway's position as MORE
axes (with real tick labels) are added after it, so reading early under
``"tight"`` would freeze a stale, wrong rect. ``"tight"``'s active layout
engine is then explicitly disabled (``fig.set_layout_engine(None)``) once
the deferred rect is captured, so the LATER final ``savefig`` doesn't
re-run ``tight_layout`` against a now-different axes set (the throwaway
gone, the facet's real sub-grid present but built from a plain, unmanaged
``GridSpec`` that ``tight_layout`` has no business touching) and silently
perturb everything again.

**Fix round 4 (2026-08-25): the "tight" gap is CLOSED (measured), not just
bounded -- the throwaway is no longer EMPTY.** Round 3's empty throwaway
predicted a footprint unrelated to the real content (a CONSTANT ``~0.0144``
x1 residual regardless of facet content, probed across 1/2/4/6/9 facets). A
literal two-pass (embed the real multi-Axes sub-grid, its OWN unmanaged
``GridSpec``, before the settle draw) was tried and REJECTED: ``matplotlib.
_tight_layout.get_tight_layout_figure`` groups every gridspec-backed Axes
by its OWN gridspec's ``(rows, cols)`` and requires each to divide the
page-wide max evenly (a ``divmod`` check) -- a facet sub-grid's shape
routinely fails that against a differently-shaped page grid (probed: 6
facets = 2x3 inside a 1x2 page grid), so the call returns ``{}`` -- NO
adjustment for the ENTIRE page, silently un-fixing every other panel too.
Fixed instead: the throwaway stays a SINGLE proxy Axes on the page's own
``gs`` (the ``divmod`` check trivially passes) but is no longer empty
(``_populate_proxy_content``).

**Fix round 5 (2026-08-25, crash fix): round 4's FIRST cut plotted raw
concatenated x/y arrays (``all_x`` once/LEVEL, ``all_y`` once/SERIES/level)
-- with >1 series/level those lengths diverge and ``Axes.plot`` raised
``ValueError`` (multi-series facets are ORDINARY, not an edge case).** A
footprint depends on axis RANGE/tick FORMAT, never line count -- so
``_facet_data_range`` returns just ``(xmin, xmax, ymin, ymax)`` (non-finite
dropped) and the proxy plots a 2-point segment instead (degenerate cases:
the two functions' own docstrings). MEASURED with the range-segment proxy,
across the round-4 matrix PLUS multi-series/ragged/non-finite cases: still
MACHINE-PRECISION (bit-identical) -- the crash fix did not reopen the gap.
Numbers: ``plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md``'s F4 log; coverage:
``test_facet_panel_multi_series_per_level_renders_and_matches`` in
``tests/test_calc_figure_page.py``.

Free (``page_rect``) placement is a DIFFERENT story from grid placement,
and SubFigure BREAKS there outright (not just under some engines): probed
with a ``GridSpec`` whose ``left``/``right``/``bottom``/``top`` carve out a
sub-region of the page (not the whole [0,1] figure) under ``layout=None``
(free placement's page-level layout is ALWAYS ``None`` -- see ``calc.
figure_page._build_page_figure``, which needs literal, un-adjusted
``page_rect`` coordinates for its ORDINARY panels too), a SubFigure's
``bbox_relative`` stayed pinned at ``(0, 0, 1, 1)`` -- the FULL figure --
regardless of the GridSpec's own margins, both before AND after
``fig.canvas.draw()``. Root cause: ``_redo_transform_rel_fig``'s ratio-only
fallback IGNORES a GridSpec's absolute ``left``/``right``/``bottom``/``top``
entirely; only an ACTIVE constrained-layout pass ever calls it again with a
real solved bbox. Since free placement can't safely turn on constrained
layout page-wide (its ordinary, non-faceted panels rely on ``fig.add_axes``
placing them at the EXACT literal rect, untouched by any layout engine --
``test_free_placement_axes_at_flipped_page_positions`` pins this), free
placement keeps the three TARGETED fixes instead (matching the fallback
plan, and the SAME fallback the grid path's ``"tight"``/``"none"`` branch
now reuses): (V1) a nested 2-row ``GridSpec`` (title band / grid) only when
``p.title`` is set; (V2) ``tick_params(labelbottom=False)`` on every
sub-axis not in the grid's own LAST row (exact ``plt.subplots(sharex=True)``
parity -- a ragged trailing row then shows no x tick labels on the row
above it either, same as the standalone renderer); (V4) the sub-grid's
``GridSpec`` is inset from the KNOWN cell rect (the literal ``page_rect``
for free placement; the throwaway's settled ``get_position()`` for the
grid ``"tight"``/``"none"`` fallback) by fixed margin fractions (below),
reserving room for tick/axis labels. The margins are a heuristic
approximation (matplotlib's own auto-margin machinery needs an active
layout engine, which this path can't use) -- probe-tuned empirically
against rects from 0.35 to 0.9 of the page (zero label pixels outside the
rect); a facet grid packed into a MUCH smaller rect (<0.2 of the page) can
still overflow by a few px, the same physical limit any dense multi-panel
grid hits at that size, not something a fixed fraction can fully solve (and
not something the raster embed handled any better in spirit -- it would
have just rendered illegibly tiny instead of overflowing).

Either placement path keeps a same-position invisible CELL-FRAME axes (no
ticks/spines/patch, added first) purely as the page-level panel LETTER's
anchor -- ``_place_label`` needs a real Axes (``.transAxes`` / ``.set_title
(loc=...)``), which neither ``SubFigure`` nor a bare ``GridSpec`` slot
provides on its own; verified this coexists cleanly with a SubFigure at the
identical gridspec slot (same resulting bbox, no double space reservation).
The sub-grid shares x among ITSELF only (``calc.figure_facets.
draw_facet_grid``'s own per-panel core, reused verbatim) and is never
linked to sibling page panels -- see ``calc.figure_page._build_page_figure``'s
own sharex/sharey opt-out.

x_label/y_label placement: the GRID path uses ``SubFigure.supxlabel``/
``supylabel`` (a real cell-scoped equivalent of the whole-page
``fig.supxlabel``/``supylabel``, exactly what fix round 1 wished existed).
The FREE-placement fallback has no such API to lean on (a bare ``GridSpec``
slot isn't a ``SubFigure``), so it keeps fix round 1's per-axes
``set_xlabel``/``set_ylabel`` on the sub-grid's own bottom-row (per COLUMN,
honoring a ragged trailing row)/first-column axes -- there is no standalone
"x_label per axis" contract to match here, so the ragged-aware placement
(smarter than a blind "last grid row only") is a deliberate choice, not a
parity requirement like the V2 tick-hiding fix above.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from matplotlib.gridspec import GridSpec

from quantized.calc.figure_facets import _grid_shape, draw_facet_grid
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_overrides import apply_axis_shape_overrides
from quantized.calc.figure_scale import apply_axis_scale, resolve_axis_scale
from quantized.calc.figure_ticks import apply_tick_formats

if TYPE_CHECKING:
    from quantized.calc.figure_page import PagePanel
    from quantized.calc.figure_styles import FigureStyle

__all__ = [
    "begin_grid_cell_fallback",
    "draw_facet_panel_cell",
    "finish_grid_cell_fallback",
]

# Free-placement fallback margins (fraction of the page_rect's own width /
# height) -- see the module doc's "Free placement ... keeps the three
# TARGETED fixes" section for why these exist and how they were tuned.
_FREE_MARGIN_LEFT = 0.34
_FREE_MARGIN_BOTTOM = 0.26
_FREE_MARGIN_RIGHT = 0.20
_FREE_MARGIN_TOP = 0.18
_FREE_TITLE_BAND = 0.16  # additional, reserved only when p.title is set


def _bottom_row_per_column(n: int, cols: int) -> dict[int, int]:
    """The last (bottom-most) VISIBLE grid row present in each column, for
    ``n`` panels tiled row-major into ``cols`` columns -- a ragged trailing
    row (``n`` not a multiple of ``cols``) can leave some columns' true
    bottom axes one row above the grid's last row (e.g. 3 panels in a 2x2
    grid: column 1's bottom-most panel is row 0, not the hidden row-1
    cell), so a flat ``index >= last_row_start`` check would miss it. Used
    by the free-placement fallback's x_label placement only -- see module
    doc."""
    last_row: dict[int, int] = {}
    for i in range(n):
        r, c = divmod(i, cols)
        last_row[c] = max(last_row.get(c, -1), r)
    return last_row


def _frame_axes(fig: Any, *, cell_spec: Any = None, rect: Any = None) -> Any:
    """A same-position invisible Axes spanning the whole cell -- exists
    purely as the page-level panel LETTER's anchor (see module doc)."""
    frame_ax = fig.add_subplot(cell_spec) if cell_spec is not None else fig.add_axes(rect)
    frame_ax.set_xticks([])
    frame_ax.set_yticks([])
    for spine in frame_ax.spines.values():
        spine.set_visible(False)
    frame_ax.patch.set_visible(False)
    return frame_ax


def _draw_grid_cell(
    fig: Any, p: PagePanel, st: FigureStyle, cell_spec: Any, rows: int, cols: int,
    resolved_x_scale: str, resolved_y_scale: str, x_label: str, y_label: str,
) -> Any:
    """Grid placement: a real ``SubFigure`` nested at the page gridspec's
    own cell -- see module doc for why this works reliably here (and not
    for free placement)."""
    assert p.facets is not None
    frame_ax = _frame_axes(fig, cell_spec=cell_spec)

    sf = fig.add_subfigure(cell_spec)
    if p.title:
        sf.suptitle(safe_mathtext_label(p.title))
    axes_grid = sf.subplots(rows, cols, sharex=True, sharey=False, squeeze=False)
    sub_axes = [ax for row in axes_grid for ax in row]

    draw_facet_grid(
        sub_axes, p.facets, st=st,
        resolved_x_scale=resolved_x_scale, resolved_y_scale=resolved_y_scale,
        x_fmt=p.x_fmt, y_fmt=p.y_fmt, overrides=p.overrides,
    )
    if x_label:
        sf.supxlabel(x_label)
    if y_label:
        sf.supylabel(y_label)
    return frame_ax


def _draw_free_cell(
    fig: Any, p: PagePanel, st: FigureStyle, rect: tuple[float, float, float, float], n: int,
    rows: int, cols: int, resolved_x_scale: str, resolved_y_scale: str,
    x_label: str, y_label: str,
) -> Any:
    """Free (``page_rect``) placement -- thin wrapper: convert the
    top-left-origin ``page_rect`` to bottom-left-origin figure-fraction
    bounds (same conversion ``figure_page``'s own free-placement branch
    applies to an ordinary panel's ``fig.add_axes``) and hand off to the
    shared inset-fallback core (``_draw_inset_cell``)."""
    x, y, w, h = rect
    left, bottom, width, height = x, 1 - y - h, w, h
    return _draw_inset_cell(
        fig, p, st, left, bottom, width, height, n, rows, cols,
        resolved_x_scale, resolved_y_scale, x_label, y_label,
    )


def _draw_inset_cell(
    fig: Any, p: PagePanel, st: FigureStyle, left: float, bottom: float, width: float,
    height: float, n: int, rows: int, cols: int, resolved_x_scale: str, resolved_y_scale: str,
    x_label: str, y_label: str,
) -> Any:
    """The shared inset-``GridSpec`` fallback core (V1/V2/V4) -- draws a
    facet sub-grid inset from an ALREADY-KNOWN bottom-left-origin
    figure-fraction cell rect. Two callers: free placement (``_draw_free_
    cell``, the rect IS the ``page_rect``, known upfront) and the grid
    ``"tight"``/``"none"`` fallback (``finish_grid_cell_fallback``, the
    rect is a throwaway placeholder axes' SETTLED ``get_position()`` --
    see module doc for why that has to be deferred)."""
    assert p.facets is not None
    frame_ax = _frame_axes(fig, rect=(left, bottom, width, height))

    inset_left = left + _FREE_MARGIN_LEFT * width
    inset_right = left + width - _FREE_MARGIN_RIGHT * width
    inset_bottom = bottom + _FREE_MARGIN_BOTTOM * height
    inset_top = bottom + height - _FREE_MARGIN_TOP * height

    if p.title:
        # V1 fallback: a nested title band reserves its OWN row instead of
        # drawing on top of the grid (an ordinary axes' set_title has no
        # "reserved space" relative to another axes at the same position).
        band_h = _FREE_TITLE_BAND * (inset_top - inset_bottom)
        title_top = inset_top
        inset_top -= band_h
        title_gs = GridSpec(
            1, 1, left=inset_left, right=inset_right,
            bottom=inset_top, top=title_top, figure=fig,
        )
        title_ax = fig.add_subplot(title_gs[0, 0])
        title_ax.set_axis_off()
        title_ax.text(
            0.5, 0.5, safe_mathtext_label(p.title), ha="center", va="center",
            fontsize=st.title_font_size, fontweight="bold",
        )

    sub_gs = GridSpec(
        rows, cols, left=inset_left, right=inset_right,
        bottom=inset_bottom, top=inset_top, figure=fig,
    )
    sub_axes: list[Any] = []
    first: Any = None
    for i in range(rows * cols):
        r, c = divmod(i, cols)
        ax = fig.add_subplot(sub_gs[r, c], sharex=first)
        if first is None:
            first = ax
        sub_axes.append(ax)

    draw_facet_grid(
        sub_axes, p.facets, st=st,
        resolved_x_scale=resolved_x_scale, resolved_y_scale=resolved_y_scale,
        x_fmt=p.x_fmt, y_fmt=p.y_fmt, overrides=p.overrides,
    )

    # V2 fallback: hide x tick labels on every sub-axis NOT in the grid's
    # own last row -- exact plt.subplots(sharex=True) parity (a ragged
    # trailing row then shows no x tick labels on the row above it either,
    # same as the standalone renderer).
    for i in range(rows * cols):
        r, _c = divmod(i, cols)
        if r != rows - 1:
            sub_axes[i].tick_params(axis="x", which="both", labelbottom=False)

    if x_label or y_label:
        bottom_row = _bottom_row_per_column(n, cols)
        for i in range(n):
            r, c = divmod(i, cols)
            if x_label and r == bottom_row[c]:
                sub_axes[i].set_xlabel(x_label)
            if y_label and c == 0:
                sub_axes[i].set_ylabel(y_label)

    return frame_ax


def _facet_geometry(p: PagePanel) -> tuple[int, int, int, str, str, str, str]:
    """``(n, rows, cols, resolved_x_scale, resolved_y_scale, x_label,
    y_label)`` -- the geometry/scale/label prep every drawing path needs,
    factored out so ``draw_facet_panel_cell`` and ``finish_grid_cell_
    fallback`` (which resolves this AFTER the deferred draw pass, not at
    the same call site) don't duplicate it."""
    assert p.facets
    n = len(p.facets)
    rows, cols = _grid_shape(n)
    resolved_x_scale = resolve_axis_scale(p.x_scale, p.x_log)
    resolved_y_scale = resolve_axis_scale(p.y_scale, p.y_log)
    x_label = safe_mathtext_label(p.x_label)
    y_label = safe_mathtext_label(p.y_label)
    return n, rows, cols, resolved_x_scale, resolved_y_scale, x_label, y_label


def draw_facet_panel_cell(
    fig: Any,
    p: PagePanel,
    st: FigureStyle,
    *,
    cell_spec: Any = None,
    rect: tuple[float, float, float, float] | None = None,
) -> Any:
    """Draw ``p.facets`` as a real vector sub-grid inside one page cell and
    return the CELL-SPANNING frame axes -- the caller (``calc.figure_page.
    _build_page_figure``) treats it exactly like any other panel's axes for
    the page letter (``_place_label``) and the sharex/sharey link
    bookkeeping (which always opts a facet panel out, since the frame axes
    carries no data scale of its own).

    Exactly one of ``cell_spec`` (a gridspec ``SubplotSpec`` -- the grid-
    placement path under ``"constrained"`` layout, dispatches to a real
    ``SubFigure``) / ``rect`` (a ``page_rect`` tuple -- the free-placement
    path, dispatches to the hand-rolled fallback) is given, matching
    ``_build_page_figure``'s own branch. Grid placement under ``"tight"``/
    ``"none"`` does NOT go through this function at all -- SubFigure's
    position solve doesn't work there (see module doc); use
    ``begin_grid_cell_fallback``/``finish_grid_cell_fallback`` instead.
    """
    n, rows, cols, resolved_x_scale, resolved_y_scale, x_label, y_label = _facet_geometry(p)

    if cell_spec is not None:
        return _draw_grid_cell(
            fig, p, st, cell_spec, rows, cols,
            resolved_x_scale, resolved_y_scale, x_label, y_label,
        )
    assert rect is not None
    return _draw_free_cell(
        fig, p, st, rect, n, rows, cols,
        resolved_x_scale, resolved_y_scale, x_label, y_label,
    )


def _facet_data_range(p: PagePanel) -> tuple[float, float, float, float] | None:
    """``(xmin, xmax, ymin, ymax)`` -- union RANGE across every level's x
    and every series' y, non-finite ignored. ``None`` if nothing finite
    exists (see module doc's fix-round-5 note)."""
    assert p.facets
    xs = [float(v) for level in p.facets for v in level.get("x", [])]
    ys = [
        float(v)
        for level in p.facets
        for s in level.get("series", [])
        for v in s.get("y", [])
    ]
    x_finite = np.asarray(xs, dtype=float)
    x_finite = x_finite[np.isfinite(x_finite)]
    y_finite = np.asarray(ys, dtype=float)
    y_finite = y_finite[np.isfinite(y_finite)]
    if x_finite.size == 0 or y_finite.size == 0:
        return None
    return (
        float(x_finite.min()), float(x_finite.max()),
        float(y_finite.min()), float(y_finite.max()),
    )


def _populate_proxy_content(proxy: Any, p: PagePanel, st: FigureStyle) -> None:
    """Plot a 2-point segment spanning ``_facet_data_range(p)`` into the
    throwaway ``proxy`` (not empty, not the real per-series data -- see
    module doc's fix-round-4/5 notes) and apply the SAME scale / tick-
    format / x_lim override / title ``draw_facet_grid`` applies for real.

    Degenerate cases: a single finite point still autoscales (two identical
    points hit the same default-margin path a real one-point series would).
    No finite data (``_facet_data_range`` -> ``None``) skips the plot call,
    leaving the proxy's default ``[0, 1]`` view -- matching what the real
    all-NaN/empty sub-panels also default to. A non-positive ``"log"``/
    ``"reciprocal"`` bound isn't special-cased: ``apply_axis_scale`` runs
    AFTER the plot call (``draw_facet_grid``'s own order), so matplotlib
    silently excludes it rather than raising, same as the real content."""
    assert p.facets
    rng = _facet_data_range(p)
    if rng is not None:
        x0, x1, y0, y1 = rng
        proxy.plot([x0, x1], [y0, y1])
    resolved_x_scale = resolve_axis_scale(p.x_scale, p.x_log)
    resolved_y_scale = resolve_axis_scale(p.y_scale, p.y_log)
    apply_axis_scale(proxy, "x", resolved_x_scale)
    apply_axis_scale(proxy, "y", resolved_y_scale)
    apply_tick_formats(proxy, p.x_fmt, p.y_fmt)
    # x_lim ONLY, same restricted override subset draw_facet_grid applies to
    # every real sub-panel (see its own doc) -- a narrowed range can change
    # the rendered tick labels' digit count/width, so it belongs in the
    # footprint estimate too.
    apply_axis_shape_overrides(proxy, st, dict(p.overrides or {}), lim_keys=("x_lim",))
    if p.title:
        proxy.set_title(safe_mathtext_label(p.title))


def begin_grid_cell_fallback(fig: Any, cell_spec: Any, p: PagePanel, st: FigureStyle) -> Any:
    """Grid placement under ``"tight"``/``"none"`` resize_mode (W1, fix
    round 3): a throwaway placeholder ``Axes`` at ``cell_spec``, added so
    its EVENTUAL ``get_position()`` (read by ``finish_grid_cell_fallback``,
    once every other page panel is also drawn) reflects whatever spacing
    an ORDINARY panel in this same slot would get -- it comes from the
    exact same ``GridSpec.get_grid_positions()`` call an ordinary
    ``add_subplot`` position does, honoring ``wspace``/``hspace``/margins
    that ``SubFigure``'s own position solve ignores outside constrained
    layout (see module doc). The caller (``calc.figure_page.
    _build_page_figure``) must keep drawing every OTHER page panel, then
    force ONE draw pass (``fig.canvas.draw()``) before calling
    ``finish_grid_cell_fallback`` -- reading the position any earlier can
    be stale under ``"tight"`` (empirically confirmed: an early read does
    NOT match the final one there, unlike ``"none"``, where it already
    does -- see module doc).

    **Fix rounds 4/5 (2026-08-25):** the throwaway is no longer left empty
    -- ``_populate_proxy_content`` plots a 2-point RANGE segment (not the
    real per-series data, which crashes on multi-series facets) spanning
    the facet's own data extent, so ``"tight"``'s whitespace-trim sees a
    real-content-like footprint. See the module doc for why (a single proxy
    Axes, not the real sub-grid)."""
    proxy = fig.add_subplot(cell_spec)
    _populate_proxy_content(proxy, p, st)
    return proxy


def finish_grid_cell_fallback(fig: Any, p: PagePanel, st: FigureStyle, throwaway: Any) -> Any:
    """Companion to ``begin_grid_cell_fallback``: read the throwaway's now-
    SETTLED position (caller must have already forced a draw pass with
    every other page panel present), remove it, and draw the real facet
    fallback content (the same inset-``GridSpec`` core free placement uses)
    at that rect. Returns the new cell-frame axes -- same contract as
    ``draw_facet_panel_cell``'s return (the caller places the page letter
    on it, etc.)."""
    n, rows, cols, resolved_x_scale, resolved_y_scale, x_label, y_label = _facet_geometry(p)
    pos = throwaway.get_position()
    left, bottom, width, height = pos.x0, pos.y0, pos.width, pos.height
    throwaway.remove()
    return _draw_inset_cell(
        fig, p, st, left, bottom, width, height, n, rows, cols,
        resolved_x_scale, resolved_y_scale, x_label, y_label,
    )
