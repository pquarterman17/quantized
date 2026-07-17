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

FREE PAGE-COORDINATE PLACEMENT (#54 residual): when every panel carries a
``page_rect`` (page-normalized ``(x, y, w, h)``, TOP-LEFT origin -- the
frontend's ``NormalizedFrameRect`` convention, e.g. a decoded Origin page
layout), panels are placed with ``fig.add_axes`` at their true page
coordinates instead of the ``rows``/``cols`` gridspec; ``rows``/``cols`` are
then accepted but unused. Mixing panels with and without a ``page_rect`` is
rejected. Unlike the grid path, overlapping rects are ALLOWED (Origin layers
can legitimately overlap).
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

from quantized.calc.figure import draw_series_axes, style_rc  # noqa: E402
from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_overrides import _validate_overrides  # noqa: E402
from quantized.calc.figure_styles import FigureStyle, figure_style  # noqa: E402

__all__ = ["PagePanel", "panel_label", "render_figure_page"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_LABEL_POSITIONS = ("nw", "ne", "outside")
# Auto-label formats, keyed by the rendered form of the FIRST panel:
# (wrap template, uppercase letters?). "none" suppresses auto labels entirely.
_LABEL_TEMPLATES: dict[str, tuple[str, bool]] = {
    "(a)": ("({})", False),
    "a)": ("{})", False),
    "a.": ("{}.", False),
    "(A)": ("({})", True),
    "A)": ("{})", True),
    "A.": ("{}.", True),
}
# Grid cap: a journal page never needs more; guards absurd allocations.
_MAX_GRID = 8


def _letters(index: int) -> str:
    """0 -> "a", 25 -> "z", 26 -> "aa", ... (spreadsheet-style rollover)."""
    out = ""
    n = index
    while True:
        out = chr(ord("a") + n % 26) + out
        n = n // 26 - 1
        if n < 0:
            return out


def panel_label(index: int, label_format: str = "(a)") -> str:
    """The auto-generated label for the ``index``-th panel (0-based, row-major
    placement order): ``panel_label(1, "(a)") == "(b)"``. ``"none"`` returns
    an empty string (no labels). Raises ``ValueError`` on an unknown format
    or a negative index."""
    if index < 0:
        raise ValueError("panel index must be >= 0")
    if label_format == "none":
        return ""
    try:
        template, upper = _LABEL_TEMPLATES[label_format]
    except KeyError as exc:
        allowed = (*_LABEL_TEMPLATES, "none")
        raise ValueError(f"label_format must be one of {allowed}") from exc
    letters = _letters(index)
    return template.format(letters.upper() if upper else letters)


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


# Tolerance on a page_rect's [0, 1] bounds -- decode rounding can put a
# rect a hair outside the exact unit square.
_RECT_EPS = 1e-6


def _validate_panel_overrides(n: int, p: PagePanel) -> None:
    """Raise ``ValueError`` on a page-incompatible per-panel override
    (``x_breaks`` / ``margins``), shared by both the grid and free-placement
    validators."""
    ov = dict(p.overrides or {})
    if "x_breaks" in ov:
        raise ValueError(f"panel {n}: x_breaks is not supported on a figure page")
    if "margins" in ov:
        raise ValueError(
            f"panel {n}: margins are page-level on a figure page; "
            "remove the per-panel margins override"
        )
    _validate_overrides(ov)


def _validate_page(rows: int, cols: int, panels: Sequence[PagePanel]) -> None:
    """Raise ``ValueError`` on an invalid page spec: bad grid, empty page,
    out-of-bounds or overlapping panels, page-incompatible overrides."""
    if rows < 1 or cols < 1:
        raise ValueError("page grid must have at least 1 row and 1 column")
    if rows > _MAX_GRID or cols > _MAX_GRID:
        raise ValueError(f"page grid is capped at {_MAX_GRID}x{_MAX_GRID}")
    if not panels:
        raise ValueError("page must contain at least one panel")
    occupied: dict[tuple[int, int], int] = {}
    for n, p in enumerate(panels):
        if p.row_span < 1 or p.col_span < 1:
            raise ValueError(f"panel {n}: row_span and col_span must be >= 1")
        if p.row < 0 or p.col < 0 or p.row + p.row_span > rows or p.col + p.col_span > cols:
            raise ValueError(
                f"panel {n} does not fit the {rows}x{cols} grid (row={p.row} "
                f"col={p.col} row_span={p.row_span} col_span={p.col_span})"
            )
        for r in range(p.row, p.row + p.row_span):
            for c in range(p.col, p.col + p.col_span):
                other = occupied.get((r, c))
                if other is not None:
                    raise ValueError(f"panels {other} and {n} overlap at grid cell ({r}, {c})")
                occupied[(r, c)] = n
        _validate_panel_overrides(n, p)


def _validate_page_rects(panels: Sequence[PagePanel]) -> None:
    """Raise ``ValueError`` on an invalid free-placement page spec: empty
    page, an out-of-bounds/degenerate ``page_rect``, page-incompatible
    overrides. Unlike ``_validate_page``, overlapping rects are ALLOWED
    (Origin layers can legitimately overlap) -- rows/cols placement is not
    involved at all."""
    if not panels:
        raise ValueError("page must contain at least one panel")
    for n, p in enumerate(panels):
        assert p.page_rect is not None  # caller guarantees this (free_placement)
        x, y, w, h = p.page_rect
        if w <= 0 or h <= 0:
            raise ValueError(f"panel {n}: page_rect width/height must be positive")
        if x < -_RECT_EPS or y < -_RECT_EPS:
            raise ValueError(f"panel {n}: page_rect x/y must be >= 0")
        if x + w > 1 + _RECT_EPS or y + h > 1 + _RECT_EPS:
            raise ValueError(
                f"panel {n}: page_rect must fit within the page (x + w <= 1, y + h <= 1)"
            )
        _validate_panel_overrides(n, p)


def _place_label(ax: Any, text: str, pos: str, st: FigureStyle) -> None:
    """Draw one panel label. ``nw``/``ne`` sit inside the axes at the top
    corner; ``outside`` uses matplotlib's LEFT title slot above the axes,
    which coexists with the panel's own (center) title -- the standard
    journal placement."""
    if not text:
        return
    size = float(st.title_font_size)
    if pos == "outside":
        ax.set_title(text, loc="left", fontweight="bold", fontsize=size)
    elif pos == "ne":
        ax.text(
            0.97, 0.96, text, transform=ax.transAxes,
            ha="right", va="top", fontweight="bold", fontsize=size,
        )
    else:  # "nw"
        ax.text(
            0.03, 0.96, text, transform=ax.transAxes,
            ha="left", va="top", fontweight="bold", fontsize=size,
        )


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
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if label_pos not in _LABEL_POSITIONS:
        raise ValueError(f"label_pos must be one of {_LABEL_POSITIONS}")
    if label_format != "none" and label_format not in _LABEL_TEMPLATES:
        allowed = (*_LABEL_TEMPLATES, "none")
        raise ValueError(f"label_format must be one of {allowed}")

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
) -> Any:
    """Build (but do not save or close) the composed page figure, in
    ``ordered`` placement order. Split out of ``render_figure_page`` so a
    test can inspect ``ax.get_position()`` directly -- the free-placement
    y-flip is otherwise only observable via rendered image bytes. Must run
    inside the caller's ``matplotlib.rc_context(style_rc(st, {}))``."""
    # Constrained layout fights manually placed axes (add_axes) -- only the
    # grid path (gridspec subplots) uses it.
    fig = (
        plt.figure(figsize=(w, h))
        if free_placement
        else plt.figure(figsize=(w, h), layout="constrained")
    )
    gs = None if free_placement else fig.add_gridspec(rows, cols)
    for idx, p in enumerate(ordered):
        if free_placement:
            assert p.page_rect is not None
            x, y, pw, ph = p.page_rect
            # y-flip: page_rect is top-left origin; matplotlib axes rects
            # are bottom-left origin.
            ax = fig.add_axes((x, 1 - y - ph, pw, ph))
        else:
            assert gs is not None
            ax = fig.add_subplot(gs[p.row : p.row + p.row_span, p.col : p.col + p.col_span])
        # Rich-text guard (GOTO #5) on every user string; see figure.py.
        series = [(safe_mathtext_label(label), y) for label, y in p.series]
        draw_series_axes(
            fig,
            ax,
            np.asarray(p.x, dtype=float),
            series,
            st=st,
            ov=dict(p.overrides or {}),
            x_log=p.x_log,
            y_log=p.y_log,
            x_scale=p.x_scale,
            y_scale=p.y_scale,
            title=safe_mathtext_label(p.title),
            x_label=safe_mathtext_label(p.x_label),
            y_label=safe_mathtext_label(p.y_label),
            series_styles=p.series_styles,
            x_fmt=p.x_fmt,
            y_fmt=p.y_fmt,
            x_step=p.x_step,
            y_step=p.y_step,
        )
        text = p.label if p.label is not None else panel_label(idx, label_format)
        _place_label(ax, safe_mathtext_label(text), label_pos, st)
    return fig
