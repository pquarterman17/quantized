"""A faceted panel as one figure-page cell (FIGURE_AUTHORING_WORKFLOW_PLAN
F4.4 follow-up, 2026-08-24), split out of ``calc.figure_page`` to keep that
module under its 500-line ceiling (the same reason ``figure_page_layout.py``
/ ``figure_page_panel_labels.py`` / ``figure_page_validate.py`` exist
separately). Replaces the earlier PNG/``imshow`` raster embed (R2, fix round
3): a faceted page panel now draws as a REAL VECTOR sub-grid of matplotlib
Axes inside its cell -- one raster cell is no longer stuck inside an
otherwise-vector PDF/SVG page export.

:func:`draw_facet_panel_cell` builds the sub-grid two ways, matching
``calc.figure_page``'s own grid-vs-free-placement split:

* grid placement -- ``matplotlib.gridspec.GridSpecFromSubplotSpec`` nested
  inside the cell's own ``SubplotSpec`` (``gs[row:row+span, col:col+span]``,
  the SAME slice ``fig.add_subplot`` would otherwise take for an ordinary
  panel), so the sub-grid inherits the page gridspec's own layout engine
  (constrained/tight/none).
* free (``page_rect``) placement -- a bounded ``matplotlib.gridspec.GridSpec``
  whose ``left``/``right``/``bottom``/``top`` are computed from the rect
  (same top-left-origin -> bottom-left-origin y-flip ``calc.figure_page``'s
  own free-placement branch uses for an ordinary panel's ``fig.add_axes``).

Either way, an invisible CELL-FRAME axes spans the whole cell first (no
ticks/spines/patch) -- it carries the page-level panel LETTER (the caller
places it exactly like any other panel's axes, via ``figure_page_panel_
labels._place_label``) and the panel's own ``title`` (a centered
``set_title``, matching how an ordinary panel's title renders), while the
real facet sub-axes draw INSIDE it. The sub-grid shares x among ITSELF only
(``calc.figure_facets.draw_facet_grid``'s own per-panel core, reused
verbatim) and is never linked to sibling page panels -- see
``calc.figure_page._build_page_figure``'s own sharex/sharey opt-out.

x_label/y_label placement: a bare ``GridSpecFromSubplotSpec``/``GridSpec``
has no cell-scoped ``supxlabel``/``supylabel`` equivalent (that's a
``Figure``-level or ``SubFigure``-level API, and a cell here is neither) --
so the panel's derived "label (unit)" strings are placed as ordinary
``set_xlabel``/``set_ylabel`` calls on the sub-grid's own bottom-row /
first-column axes (per COLUMN, honoring a ragged trailing row rather than
assuming every column reaches the last grid row), a per-cell approximation
of the whole-page ``fig.supxlabel``/``fig.supylabel`` convention.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from matplotlib.gridspec import GridSpec, GridSpecFromSubplotSpec

from quantized.calc.figure_facets import _grid_shape, draw_facet_grid
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_scale import resolve_axis_scale

if TYPE_CHECKING:
    from quantized.calc.figure_page import PagePanel
    from quantized.calc.figure_styles import FigureStyle

__all__ = ["draw_facet_panel_cell"]


def _bottom_row_per_column(n: int, cols: int) -> dict[int, int]:
    """The last (bottom-most) VISIBLE grid row present in each column, for
    ``n`` panels tiled row-major into ``cols`` columns -- a ragged trailing
    row (``n`` not a multiple of ``cols``) can leave some columns' true
    bottom axes one row above the grid's last row (e.g. 3 panels in a 2x2
    grid: column 1's bottom-most panel is row 0, not the hidden row-1
    cell), so a flat ``index >= last_row_start`` check would miss it."""
    last_row: dict[int, int] = {}
    for i in range(n):
        r, c = divmod(i, cols)
        last_row[c] = max(last_row.get(c, -1), r)
    return last_row


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
    placement path) / ``rect`` (a ``page_rect`` tuple -- the free-placement
    path) is given, matching ``_build_page_figure``'s own branch.
    """
    assert p.facets
    n = len(p.facets)
    rows, cols = _grid_shape(n)

    sub_gs: Any
    if cell_spec is not None:
        frame_ax = fig.add_subplot(cell_spec)
        sub_gs = GridSpecFromSubplotSpec(rows, cols, subplot_spec=cell_spec)
    else:
        assert rect is not None
        x, y, w, h = rect
        # y-flip: page_rect is top-left origin; matplotlib figure fractions
        # are bottom-left origin -- same conversion figure_page's own
        # free-placement branch applies to an ordinary panel's fig.add_axes.
        left, bottom, width, height = x, 1 - y - h, w, h
        frame_ax = fig.add_axes((left, bottom, width, height))
        sub_gs = GridSpec(
            rows, cols, left=left, right=left + width,
            bottom=bottom, top=bottom + height, figure=fig,
        )

    frame_ax.set_xticks([])
    frame_ax.set_yticks([])
    for spine in frame_ax.spines.values():
        spine.set_visible(False)
    frame_ax.patch.set_visible(False)
    if p.title:
        frame_ax.set_title(safe_mathtext_label(p.title))

    sub_axes: list[Any] = []
    first: Any = None
    for i in range(rows * cols):
        r, c = divmod(i, cols)
        ax = fig.add_subplot(sub_gs[r, c], sharex=first)
        if first is None:
            first = ax
        sub_axes.append(ax)

    resolved_x_scale = resolve_axis_scale(p.x_scale, p.x_log)
    resolved_y_scale = resolve_axis_scale(p.y_scale, p.y_log)
    draw_facet_grid(
        sub_axes, p.facets, st=st,
        resolved_x_scale=resolved_x_scale, resolved_y_scale=resolved_y_scale,
        x_fmt=p.x_fmt, y_fmt=p.y_fmt, overrides=p.overrides,
    )

    x_label = safe_mathtext_label(p.x_label)
    y_label = safe_mathtext_label(p.y_label)
    if x_label or y_label:
        bottom_row = _bottom_row_per_column(n, cols)
        for i in range(n):
            r, c = divmod(i, cols)
            if x_label and r == bottom_row[c]:
                sub_axes[i].set_xlabel(x_label)
            if y_label and c == 0:
                sub_axes[i].set_ylabel(y_label)

    return frame_ax
