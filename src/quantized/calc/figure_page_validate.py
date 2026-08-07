"""Figure-page spec validation (GOTO #4 / #54), split out of ``calc.figure_page``
(2026-08-07 headroom restoration after F3.5): both the grid-placement and the
free-page-coordinate (``page_rect``) validators, plus the per-panel override
check shared by both. Pure dict/number checks -- no matplotlib import needed
here at all. Kept together because they share ``_validate_panel_overrides``
and validate the SAME ``PagePanel`` contract; F3.6 (export from PageDocument)
feeds the same dataclass through the same ``render_figure_page`` entry point
regardless of whether a panel's data originated in a live session or a
reopened PageDocument, so these validation RULES are not expected to change
for that item.

``PagePanel`` is imported only under ``TYPE_CHECKING`` (this module's
functions never execute anything from ``calc.figure_page`` at runtime) so
``calc.figure_page`` can import these functions back at module level without
a circular import -- the same ``TYPE_CHECKING``-only pattern already used by
``io/_hdf5_layout.py`` for its own cross-module type need.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from quantized.calc.figure_overrides import _validate_overrides

if TYPE_CHECKING:
    from quantized.calc.figure_page import PagePanel

__all__ = ["_validate_page", "_validate_page_rects"]

# Grid cap: a journal page never needs more; guards absurd allocations.
_MAX_GRID = 8
# Tolerance on a page_rect's [0, 1] bounds -- decode rounding can put a
# rect a hair outside the exact unit square.
_RECT_EPS = 1e-6


def _validate_panel_overrides(n: int, p: PagePanel) -> None:
    """Raise ``ValueError`` on a page-incompatible per-panel override
    (``x_breaks`` / ``margins``) or a malformed ``y2_mask`` (GUI_INTERACTION
    #12 slice 4c -- mirrors ``calc.figure._render_impl``'s own
    ``len(y2_mask) != len(series)`` guard), shared by both the grid and
    free-placement validators."""
    ov = dict(p.overrides or {})
    if "x_breaks" in ov:
        raise ValueError(f"panel {n}: x_breaks is not supported on a figure page")
    if "margins" in ov:
        raise ValueError(
            f"panel {n}: margins are page-level on a figure page; "
            "remove the per-panel margins override"
        )
    _validate_overrides(ov)
    if p.y2_mask is not None and len(p.y2_mask) != len(p.series):
        raise ValueError(f"panel {n}: y2_mask must have the same length as series")


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
