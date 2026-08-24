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

``SubFigure`` (``fig.add_subfigure``) fixes (V1)/(V2) for free -- calling
its own ``.subplots(sharex=True, ...)`` gives EXACT standalone parity
(automatic interior-tick-label hiding), and ``.suptitle`` reserves real
space above the grid instead of drawing over it. Verified empirically
(2026-08-24) for GRID placement (nested in the page's own ``fig.
add_gridspec`` cell) across all three page layout engines (``constrained``
/ ``tight`` / ``none``): a SubFigure's own positioning code
(``SubFigure._redo_transform_rel_fig``) computes its bbox from the PARENT
gridspec's row/col RATIOS alone when no layout engine actively re-solves it
-- for a plain multi-cell ``add_gridspec`` with no explicit margins, that
ratio calc already lands on the correct cell bounds (confirmed: exact ~0.5
split for a 1x2 page grid under ``layout=None``/``"tight"``/``"constrained"``
alike), and ``"constrained"`` (the page's own default) refines it further
via the real constrained-layout solve.

Free (``page_rect``) placement is a DIFFERENT story, and SubFigure BREAKS
there: probed with a ``GridSpec`` whose ``left``/``right``/``bottom``/``top``
carve out a sub-region of the page (not the whole [0,1] figure) under
``layout=None`` (free placement's page-level layout is ALWAYS ``None`` --
see ``calc.figure_page._build_page_figure``, which needs literal, un-
adjusted ``page_rect`` coordinates for its ORDINARY panels too), a
SubFigure's ``bbox_relative`` stayed pinned at ``(0, 0, 1, 1)`` -- the FULL
figure -- regardless of the GridSpec's own margins, both before AND after
``fig.canvas.draw()``. Root cause: ``_redo_transform_rel_fig``'s ratio-only
fallback IGNORES a GridSpec's absolute ``left``/``right``/``bottom``/``top``
entirely; only an ACTIVE constrained-layout pass ever calls it again with a
real solved bbox. Since free placement can't safely turn on constrained
layout page-wide (its ordinary, non-faceted panels rely on ``fig.add_axes``
placing them at the EXACT literal rect, untouched by any layout engine --
``test_free_placement_axes_at_flipped_page_positions`` pins this), free
placement keeps the three TARGETED fixes instead (matching the fallback
plan): (V1) a nested 2-row ``GridSpec`` (title band / grid) only when
``p.title`` is set; (V2) ``tick_params(labelbottom=False)`` on every
sub-axis not in the grid's own LAST row (exact ``plt.subplots(sharex=True)``
parity -- a ragged trailing row then shows no x tick labels on the row
above it either, same as the standalone renderer); (V4) the sub-grid's
``GridSpec`` is inset from the ``page_rect`` by fixed margin fractions
(below), reserving room for tick/axis labels. The margins are a heuristic
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

from matplotlib.gridspec import GridSpec

from quantized.calc.figure_facets import _grid_shape, draw_facet_grid
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_scale import resolve_axis_scale

if TYPE_CHECKING:
    from quantized.calc.figure_page import PagePanel
    from quantized.calc.figure_styles import FigureStyle

__all__ = ["draw_facet_panel_cell"]

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
    """Free (``page_rect``) placement fallback -- SubFigure breaks here (see
    module doc), so the sub-grid is a hand-rolled, inset ``GridSpec`` with
    the three targeted V1/V2/V4 fixes applied directly."""
    assert p.facets is not None
    x, y, w, h = rect
    # y-flip: page_rect is top-left origin; matplotlib figure fractions are
    # bottom-left origin -- same conversion figure_page's own free-placement
    # branch applies to an ordinary panel's fig.add_axes.
    left, bottom, width, height = x, 1 - y - h, w, h
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
    placement path, dispatches to a real ``SubFigure``) / ``rect`` (a
    ``page_rect`` tuple -- the free-placement path, dispatches to the
    hand-rolled fallback) is given, matching ``_build_page_figure``'s own
    branch. See the module doc for why the two paths use different
    mechanisms.
    """
    assert p.facets
    n = len(p.facets)
    rows, cols = _grid_shape(n)
    resolved_x_scale = resolve_axis_scale(p.x_scale, p.x_log)
    resolved_y_scale = resolve_axis_scale(p.y_scale, p.y_log)
    x_label = safe_mathtext_label(p.x_label)
    y_label = safe_mathtext_label(p.y_label)

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
