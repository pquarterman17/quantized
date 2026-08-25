"""Multi-panel figure page composition (GOTO #4): N different plots -> ONE page.

Pure layer: panel data in -> image bytes out. Composes pre-built panels (each
the same ``(x, series)`` payload ``calc.figure`` renders singly) onto a single
matplotlib page: a rows x cols grid with optional per-panel row/col spans,
journal-style panel labels ("(a)", "(b)", ... -- auto-generated in row-major
placement order, or overridden per panel), and ONE style preset applied
page-wide. This is the "Figure 1(a)-(d)" workflow with zero external
post-processing: PDF / SVG vector by default, PNG / TIFF raster at a chosen
DPI (the low-DPI PNG render doubles as the composer UI's preview image).

The per-axes rendering body is shared with the single-figure renderer via
``figure.draw_series_axes``, so a panel on a page looks exactly like its
single-figure export. Every user-supplied string (panel titles, axis labels,
series labels, panel labels) is routed through the GOTO #5 rich-text guard
(``figure_labels.safe_mathtext_label``): valid ``$...$`` mathtext renders,
invalid markup degrades to literal text -- an export must never error on a
label. Two single-figure overrides are page-incompatible and rejected with a
clear ``ValueError`` (-> 422 at the route): per-panel ``x_breaks`` (the break
renderer owns its own figure) and per-panel ``margins`` (page layout is
constrained-layout, figure-level).

F3.5 layout controls (gap, link/unlink, alignment, resize mode) are pure
math in the sibling module ``calc.figure_page_layout`` -- see its doc.

FREE PAGE-COORDINATE PLACEMENT (#54 residual): when every panel carries a
``page_rect`` (page-normalized ``(x, y, w, h)``, TOP-LEFT origin -- the
frontend's ``NormalizedFrameRect`` convention, e.g. a decoded Origin page
layout), panels are placed with ``fig.add_axes`` at their true page
coordinates instead of the ``rows``/``cols`` gridspec; ``rows``/``cols`` are
then accepted but unused. Mixing panels with and without a ``page_rect`` is
rejected. Unlike the grid path, overlapping rects are ALLOWED (Origin layers
can legitimately overlap).

FACETED PANELS (F4.4 follow-up, 2026-08-24): a panel whose ``PagePanel.facets``
is set draws as a REAL VECTOR sub-grid of matplotlib Axes inside its cell --
``calc.figure_page_facets.draw_facet_panel_cell``, a sibling module (kept
separate to stay under this module's own 500-line ceiling) that reuses
``calc.figure_facets.draw_facet_grid``'s shared per-panel drawing core, so a
faceted cell renders identically to the standalone facet export, just inside
one page cell instead of its own figure. No raster embed anywhere on the
page: PDF/SVG page exports stay true vector even with a faceted panel.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless: render to a buffer, never to a display

import matplotlib.pyplot as plt  # noqa: E402  (must follow matplotlib.use)
import numpy as np  # noqa: E402
from numpy.typing import ArrayLike  # noqa: E402

from quantized.calc import figure_page_layout as fpl  # noqa: E402
from quantized.calc.figure import draw_series_axes, style_rc  # noqa: E402
from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_page_facets import (  # noqa: E402
    begin_grid_cell_fallback,
    draw_facet_panel_cell,
    finish_grid_cell_fallback,
)
from quantized.calc.figure_page_panel_labels import (  # noqa: E402
    _LABEL_TEMPLATES,
    _place_label,
    panel_label,
)
from quantized.calc.figure_page_validate import _validate_page, _validate_page_rects  # noqa: E402
from quantized.calc.figure_styles import FigureStyle, figure_style  # noqa: E402

__all__ = ["PagePanel", "panel_label", "render_figure_page"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_LABEL_POSITIONS = ("nw", "ne", "outside")


@dataclass(frozen=True)
class PagePanel:
    """One panel of a figure page: the same ``(x, series)`` payload
    ``calc.figure`` renders singly, plus its grid placement. ``label=None``
    means auto ("(a)", "(b)", ... in row-major placement order); ``label=""``
    suppresses the label on this panel only."""

    x: ArrayLike
    series: Sequence[tuple[str, ArrayLike]]
    row: int
    col: int
    row_span: int = 1
    col_span: int = 1
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    x_log: bool = False
    y_log: bool = False
    # MAIN #12: linear/log/reciprocal, source of truth when set; x_log/y_log
    # are the back-compat fallback (see figure_scale.resolve_axis_scale).
    x_scale: str | None = None
    y_scale: str | None = None
    # MAIN #24: tick-label number format ({"mode": ..., "digits": ...},
    # AxisFormat-shaped) -- each panel carries its OWN, mirroring the screen
    # (a figure page composes several independently-configured plot views).
    x_fmt: Mapping[str, Any] | None = None
    y_fmt: Mapping[str, Any] | None = None
    x_step: float | None = None
    y_step: float | None = None
    series_styles: Sequence[Mapping[str, Any] | None] | None = None
    overrides: Mapping[str, Any] | None = None
    label: str | None = None
    # #54 residual: page-normalized (x, y, w, h), TOP-LEFT origin. When every
    # panel on the page sets this, render_figure_page places panels at their
    # true page coordinates instead of the rows/cols grid -- see the module
    # docstring. None (the default) keeps the grid path byte-identical.
    page_rect: tuple[float, float, float, float] | None = None
    # Secondary (right) Y axis, matplotlib twinx (GUI_INTERACTION #12 slice
    # 4c) -- mirrors calc.figure._render_impl's y2 params verbatim (see its
    # own doc): `y2_mask` is parallel to `series`, True marks a channel drawn
    # on the secondary axis via a real `Axes.twinx()`
    # (`figure_y2.draw_secondary_axes`, reused so a doubleY panel on a page
    # looks exactly like its single-figure export). None/all-False (the
    # default) is today's single-axis behaviour, byte-identical. A fixed
    # secondary range rides `overrides["y2_lim"]`; minor ticks ride
    # `overrides["ticks"]["minor"]` -- same as the single-figure path, no new
    # override keys. Rejected together with `x_breaks` (that combination is
    # already impossible: `_validate_panel_overrides` rejects any `x_breaks`
    # override on a page panel outright).
    y2_mask: Sequence[bool] | None = None
    y2_label: str = ""
    y2_scale: str | None = None
    y2_fmt: Mapping[str, Any] | None = None
    y2_step: float | None = None
    # F4.4 follow-up (2026-08-24): a faceted panel's RESOLVED small-multiples
    # data -- the same reshaped panel-dict list `calc.figure_facets.
    # render_facets_figure` takes (`routes.export_figures._facet_panels`
    # builds it from the wire `FigureFacet` list, shared by both the
    # standalone `/figure` facet branch and `routes.export_page`). When set,
    # the panel is drawn as a REAL VECTOR sub-grid of matplotlib Axes inside
    # this cell -- `calc.figure_page_facets.draw_facet_panel_cell`, reusing
    # `calc.figure_facets.draw_facet_grid`'s shared per-panel core -- instead
    # of the ordinary single-Axes `_draw_panel` path below. `x`/`series` are
    # unused (pass empty placeholders); `x_scale`/`y_scale`/`x_log`/`y_log`/
    # `x_fmt`/`y_fmt`/`overrides` (x_lim/grid) apply to EVERY sub-panel, same
    # as the standalone facet renderer; `title` becomes the CELL's own
    # (centered) title on the invisible cell-frame axes; `x_label`/`y_label`
    # place on the sub-grid's bottom-row/first-column axes (see
    # `calc.figure_page_facets`'s own doc for why). The page-level panel
    # LETTER (`label`/auto-sequence) still applies, anchored on that same
    # cell-frame axes -- same mechanism every other panel's letter uses.
    # Replaces the pre-round PNG/`imshow` raster embed (R2, fix round 3).
    facets: list[dict[str, Any]] | None = None


def _rect_sort_key(p: PagePanel) -> tuple[float, float]:
    """Top-to-bottom, left-to-right by ``page_rect`` (y, x) -- the free-
    placement auto-label order. Caller guarantees ``page_rect`` is set (only
    used once every panel on the page has one)."""
    assert p.page_rect is not None
    return (p.page_rect[1], p.page_rect[0])


def render_figure_page(
    panels: Sequence[PagePanel],
    *,
    rows: int,
    cols: int,
    fmt: str = "pdf",
    style: str = "default",
    width_in: float | None = None,
    height_in: float | None = None,
    dpi: int | None = None,
    label_format: str = "(a)",
    label_pos: str = "nw",
    row_gap: float | None = None,
    col_gap: float | None = None,
    link_x: bool = False,
    link_y: bool = False,
    align_labels: bool = False,
    resize_mode: str = "constrained",
) -> bytes:
    """Compose ``panels`` onto one rows x cols page and render to image bytes.

    ``fmt`` is ``pdf`` / ``svg`` (vector, the default convention) or ``png`` /
    ``tiff`` (raster at ``dpi``; ``None`` = the preset's calibrated dpi).
    ``style`` names a publication preset applied page-wide (fonts, line
    widths, box/ticks/grid). Page size: ``width_in`` defaults to the preset's
    figure width -- the journal-column convention the preset encodes (``aps``
    8.6 cm ~ 3.39 in single column; ``aps_double`` 17.8 cm ~ 7.0 in double
    column, the APS sizes) -- and ``height_in`` defaults so each grid cell
    keeps the preset's own aspect ratio. ``label_format`` / ``label_pos``
    control the auto panel labels (see :func:`panel_label`, :func:`_place_label`);
    a panel's explicit ``label`` wins over the auto sequence. Raises
    ``ValueError`` on any invalid spec (unknown format/style/label options,
    empty grid, out-of-bounds or overlapping panels).

    #54 residual: when every panel sets ``page_rect``, panels are placed at
    their true page coordinates instead of the ``rows``/``cols`` grid (see
    the module docstring); ``rows``/``cols`` are then accepted but unused,
    and overlapping rects are allowed. Mixing panels with and without
    ``page_rect`` raises ``ValueError``.

    F3.5 layout controls (see ``calc.figure_page_layout``): ``row_gap``/
    ``col_gap`` are gridspec spacing fractions (``None`` = engine default);
    ``link_x``/``link_y`` share every panel's x/y-axis limits ("link all");
    ``align_labels`` calls ``fig.align_labels()``; ``resize_mode`` picks the
    layout engine (``"constrained"`` default / ``"tight"`` / ``"none"``).
    All five default to today's exact rendering; free placement ignores
    ``row_gap``/``col_gap``/``resize_mode`` but still honors the links.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if label_pos not in _LABEL_POSITIONS:
        raise ValueError(f"label_pos must be one of {_LABEL_POSITIONS}")
    if label_format != "none" and label_format not in _LABEL_TEMPLATES:
        allowed = (*_LABEL_TEMPLATES, "none")
        raise ValueError(f"label_format must be one of {allowed}")
    fpl.validate_layout(row_gap, col_gap, resize_mode)

    has_rect = [p.page_rect is not None for p in panels]
    free_placement = any(has_rect)
    if free_placement and not all(has_rect):
        raise ValueError(
            "panels must either all set page_rect or none -- mixed free/grid "
            "placement is not supported"
        )
    if free_placement:
        _validate_page_rects(panels)
    else:
        _validate_page(rows, cols, panels)

    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)

    w = float(width_in) if width_in is not None else st.fig_width_in
    if free_placement:
        # rows/cols are meaningless in free placement -- no grid-cell aspect
        # to preserve, so height falls back to the preset's own aspect.
        h = float(height_in) if height_in is not None else st.fig_height_in
    else:
        h = (
            float(height_in)
            if height_in is not None
            else w * (st.fig_height_in / st.fig_width_in) * (rows / cols)
        )
    if w <= 0 or h <= 0:
        raise ValueError("width_in and height_in must be positive")

    # Placement order defines the auto-label sequence: row-major grid cell,
    # or top-to-bottom/left-to-right by page_rect (y, x) in free placement.
    if free_placement:
        ordered = sorted(panels, key=_rect_sort_key)
    else:
        ordered = sorted(panels, key=lambda p: (p.row, p.col))
    # (matplotlib's RcParams Literal-key type is impractical with the dynamic
    # font.<generic> key -- same targeted ignore as calc.figure.)
    with matplotlib.rc_context(style_rc(st, {})):  # type: ignore[arg-type]
        fig = _build_page_figure(
            ordered,
            free_placement=free_placement,
            w=w,
            h=h,
            rows=rows,
            cols=cols,
            st=st,
            label_format=label_format,
            label_pos=label_pos,
            row_gap=row_gap,
            col_gap=col_gap,
            link_x=link_x,
            link_y=link_y,
            align_labels=align_labels,
            resize_mode=resize_mode,
        )
        try:
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def _build_page_figure(
    ordered: Sequence[PagePanel],
    *,
    free_placement: bool,
    w: float,
    h: float,
    rows: int,
    cols: int,
    st: FigureStyle,
    label_format: str,
    label_pos: str,
    row_gap: float | None = None,
    col_gap: float | None = None,
    link_x: bool = False,
    link_y: bool = False,
    align_labels: bool = False,
    resize_mode: str = "constrained",
) -> Any:
    """Build (but do not save or close) the composed page figure, in
    ``ordered`` placement order. Split out of ``render_figure_page`` so a
    test can inspect ``ax.get_position()`` directly -- the free-placement
    y-flip is otherwise only observable via rendered image bytes. Must run
    inside the caller's ``matplotlib.rc_context(style_rc(st, {}))``. F3.5
    kwargs: see ``render_figure_page``'s doc -- free placement always
    ignores ``resize_mode``/gaps but still honors ``link_x``/``link_y``."""
    engine, spacing = (
        (None, {}) if free_placement else fpl.layout_engine_kwargs(resize_mode, row_gap, col_gap)
    )
    fig = plt.figure(figsize=(w, h), layout=engine)
    gs = None if free_placement else fig.add_gridspec(rows, cols, **spacing)
    # A faceted panel's sub-grid has its OWN internal x-sharing (see
    # calc.figure_page_facets) and the cell-frame axes standing in for it
    # here carries no data of its own -- share_targets' facet_mask keeps it
    # out of the link graph entirely, as both a source AND a target (V3, fix
    # round 2: anchoring unconditionally on index 0 regardless of facet
    # status was a placement-order bug -- see share_targets' own doc).
    facet_mask = [p.facets is not None for p in ordered]
    share_x = fpl.share_targets(len(ordered), link_x, facet_mask)
    share_y = fpl.share_targets(len(ordered), link_y, facet_mask)
    # W1 (fix round 3): a grid-placement facet cell's SubFigure position
    # solve only honors true cell geometry (wspace/margins) under
    # "constrained" layout -- see calc.figure_page_facets' module doc.
    # Under "tight"/"none", the cell is instead resolved through a
    # DEFERRED variant of the free-placement fallback: a throwaway axes
    # stands in during this loop (so placement order / sharex-sharey
    # indices are unaffected), and once every OTHER panel is also drawn,
    # one draw pass settles its true position -- see the deferred-handling
    # block after this loop.
    use_grid_subfigure = not free_placement and resize_mode == "constrained"
    deferred: list[tuple[Any, PagePanel, str]] = []
    axes: list[Any] = []
    for idx, p in enumerate(ordered):
        sx, sy = share_x[idx], share_y[idx]
        sharex = axes[sx] if sx is not None else None
        sharey = axes[sy] if sy is not None else None
        text = p.label if p.label is not None else panel_label(idx, label_format)
        if p.facets is not None and not free_placement and not use_grid_subfigure:
            assert gs is not None
            cell_spec = gs[p.row : p.row + p.row_span, p.col : p.col + p.col_span]
            throwaway = begin_grid_cell_fallback(fig, cell_spec)
            axes.append(throwaway)
            deferred.append((throwaway, p, safe_mathtext_label(text)))
            continue
        if p.facets is not None:
            if free_placement:
                assert p.page_rect is not None
                ax = draw_facet_panel_cell(fig, p, st, rect=p.page_rect)
            else:
                assert gs is not None
                cell_spec = gs[p.row : p.row + p.row_span, p.col : p.col + p.col_span]
                ax = draw_facet_panel_cell(fig, p, st, cell_spec=cell_spec)
        elif free_placement:
            assert p.page_rect is not None
            x, y, pw, ph = p.page_rect
            # y-flip: page_rect is top-left origin; matplotlib axes rects
            # are bottom-left origin.
            ax = fig.add_axes((x, 1 - y - ph, pw, ph), sharex=sharex, sharey=sharey)
            _draw_panel(fig, ax, p, st)
        else:
            assert gs is not None
            ax = fig.add_subplot(
                gs[p.row : p.row + p.row_span, p.col : p.col + p.col_span],
                sharex=sharex,
                sharey=sharey,
            )
            _draw_panel(fig, ax, p, st)
        axes.append(ax)
        _place_label(ax, safe_mathtext_label(text), label_pos, st)
    if deferred:
        # Every other page panel is now drawn -- ONE draw pass settles
        # "tight"'s whitespace-trimming solve (empirically confirmed
        # necessary: an early read is stale under "tight", though already
        # correct under "none" -- see module doc) before reading any
        # throwaway's final position.
        fig.canvas.draw()
        for throwaway, p, text in deferred:
            frame_ax = finish_grid_cell_fallback(fig, p, st, throwaway)
            _place_label(frame_ax, text, label_pos, st)
        if resize_mode == "tight":
            # Freeze positions: prevent tight_layout from re-running at
            # the caller's final savefig against a now-different axes set
            # (the throwaway gone, the facet's real sub-grid present but
            # built from a plain, unmanaged GridSpec tight_layout has no
            # business touching) and silently perturbing everything again.
            fig.set_layout_engine(None)
    if align_labels:
        fig.align_labels()
    return fig


def _draw_panel(fig: Any, ax: Any, p: PagePanel, st: FigureStyle) -> None:
    """Draw one panel's series into ``ax`` -- ``draw_series_axes`` (single
    axes) normally, or ``figure_y2.render_with_secondary_axis`` (a real
    ``Axes.twinx()``) when ``p.y2_mask`` marks at least one channel for the
    secondary axis (GUI_INTERACTION #12 slice 4c) -- mirrors
    ``calc.figure._render_impl``'s own ``has_y2`` dispatch verbatim, so a
    doubleY panel on a page looks exactly like its single-figure export.

    Never called for a faceted panel (``p.facets is not None``) -- that
    branch is handled entirely by ``calc.figure_page_facets.
    draw_facet_panel_cell`` in ``_build_page_figure``'s own loop above,
    which draws a real vector sub-grid instead of a single Axes."""
    # Rich-text guard (GOTO #5) on every user string; see figure.py.
    series = [(safe_mathtext_label(label), y) for label, y in p.series]
    ov = dict(p.overrides or {})
    xv = np.asarray(p.x, dtype=float)
    title = safe_mathtext_label(p.title)
    x_label = safe_mathtext_label(p.x_label)
    y_label = safe_mathtext_label(p.y_label)
    y2_mask = list(p.y2_mask) if p.y2_mask is not None else [False] * len(series)
    if any(y2_mask):
        # Lazy import: mirrors calc.figure._render_impl's own lazy import of
        # this module -- keeps the twinx orchestration out of this module's
        # top-level import list.
        from quantized.calc.figure_y2 import render_with_secondary_axis

        render_with_secondary_axis(
            fig, ax, xv, series, p.series_styles, y2_mask,
            st=st, ov=ov, x_log=p.x_log, y_log=p.y_log,
            x_scale=p.x_scale, y_scale=p.y_scale,
            title=title, x_label=x_label, y_label=y_label,
            x_fmt=p.x_fmt, y_fmt=p.y_fmt, x_step=p.x_step, y_step=p.y_step,
            y2_label=safe_mathtext_label(p.y2_label), y2_scale=p.y2_scale,
            y2_fmt=p.y2_fmt, y2_step=p.y2_step,
        )
        return
    draw_series_axes(
        fig,
        ax,
        xv,
        series,
        st=st,
        ov=ov,
        x_log=p.x_log,
        y_log=p.y_log,
        x_scale=p.x_scale,
        y_scale=p.y_scale,
        title=title,
        x_label=x_label,
        y_label=y_label,
        series_styles=p.series_styles,
        x_fmt=p.x_fmt,
        y_fmt=p.y_fmt,
        x_step=p.x_step,
        y_step=p.y_step,
    )
