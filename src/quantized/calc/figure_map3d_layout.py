"""The static 3-D figure's layout (``calc.figure_map``'s 3-D kinds): a plot
column, the colour bar's own column to its right, a title strip above and a
footnote strip below -- measured, not guessed, so the bar's ticks and label,
the title and the note always fit -- and the crop that keeps a zoomed plot
inside its column.

FIXED, not tight_layout: tight_layout measures a zoomed box's overflow as
"content" and shrinks the axes to fit it, so a zoom-2 export came out barely
larger than zoom 1; the screen magnifies, and so must this. Nothing is drawn
under the bar, the title or the note: marks are clipped to the column and a
figure-coloured mask covers the panes, grid and axis text past it, as the
screen clips its plot area (``Map3D/render3d.ts``).

Pure matplotlib (figure in, figure laid out); no I/O.
"""

from __future__ import annotations

from typing import Any

from matplotlib.patches import Rectangle

__all__ = ["axes_3d", "colorbar_axes", "finish_3d"]

# Inches. The axes inset inside the column leaves the z tick labels and axis
# titles room at zoom 1 (matplotlib draws them outside the box, inside its
# square); the gutter separates the column's crop from the bar.
_INSET_LEFT, _INSET_RIGHT, _INSET_BOTTOM, _INSET_TOP = 0.15, 0.45, 0.15, 0.1
_GUTTER, _BAR_W, _EDGE = 0.25, 0.12, 0.06
_PT = 1.0 / 72.0


def axes_3d(fig: Any) -> Any:
    """The 3-D axes, at a provisional position (``finish_3d`` places it)."""
    return fig.add_axes((0.05, 0.05, 0.7, 0.85), projection="3d")


def colorbar_axes(fig: Any) -> Any:
    """The colour bar's axes, at a provisional position (``finish_3d`` places it)."""
    return fig.add_axes((0.85, 0.15, 0.025, 0.7))


def _text_height(fig: Any, renderer: Any, text: str, size: float) -> float:
    t = fig.text(0, 0, text, fontsize=size)
    h = float(t.get_window_extent(renderer).height) / float(fig.dpi)
    t.remove()
    return h


def finish_3d(
    fig: Any, ax: Any, cax: Any, title: str, title_size: float, note: str, note_size: float
) -> None:
    """Lay the 3-D figure out and crop the plot to its column. Call once every
    mark and the colour bar (``cax``, or None) are drawn."""
    w_in, h_in = fig.get_size_inches()
    renderer = fig.canvas.get_renderer()
    title_h = _text_height(fig, renderer, title, title_size) + 10 * _PT if title else 0.0
    note_h = _text_height(fig, renderer, note, note_size) + 6 * _PT if note else 0.0
    right_in = float(w_in)
    if cax is not None:
        # What the bar's ticks and label need right of the bar itself, measured.
        bar = cax.get_window_extent(renderer)
        tight = cax.get_tightbbox(renderer)
        extra = max(0.0, float(tight.x1 - bar.x1) / fig.dpi)
        right_in = float(w_in) - (_EDGE + extra + _BAR_W + _GUTTER)
        bar_h = 0.7 * (float(h_in) - title_h - note_h)
        y0 = note_h + (float(h_in) - title_h - note_h - bar_h) / 2
        cax.set_position((
            (right_in + _GUTTER) / w_in, y0 / h_in, _BAR_W / w_in, bar_h / h_in,
        ))
    right_in = max(right_in, 0.4 * float(w_in))
    right, bottom, top = right_in / w_in, note_h / h_in, 1.0 - title_h / h_in
    ax.set_position((
        _INSET_LEFT / w_in, bottom + _INSET_BOTTOM / h_in,
        (right_in - _INSET_LEFT - _INSET_RIGHT) / w_in,
        top - bottom - (_INSET_BOTTOM + _INSET_TOP) / h_in,
    ))
    clip = Rectangle((0.0, bottom), right, top - bottom, transform=fig.transFigure)
    for artist in [*ax.collections, *ax.lines]:
        artist.set_clip_path(clip)
    z = ax.get_zorder()
    bg = fig.get_facecolor()

    def mask(x0: float, y0: float, w: float, h: float) -> None:
        fig.add_artist(Rectangle(
            (x0, y0), w, h, transform=fig.transFigure, facecolor=bg, edgecolor="none",
            zorder=z + 0.5,
        ))

    if cax is not None:
        mask(right, 0.0, 1.0 - right, 1.0)
        cax.set_zorder(z + 1)
    if title:
        mask(0.0, top, right, 1.0 - top)
        fig.text(right / 2, (top + 1.0) / 2, title, ha="center", va="center",
                 fontsize=title_size, zorder=z + 1)
    if note:
        mask(0.0, 0.0, right, bottom)
        fig.text(0.01, bottom / 2, note, ha="left", va="center", fontsize=note_size,
                 zorder=z + 1)
