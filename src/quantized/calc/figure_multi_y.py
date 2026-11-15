"""Origin-style multiple Y axes for figure export (gap audit 4 G11).

The export half of ``frontend/src/lib/multiY.ts`` / ``lib/uplotMultiY.ts``:
each extra Y axis (Y3, Y4, ...) is one more ``Axes.twinx()``, its right spine
pushed ``outward`` by whole slots of :data:`SLOT_PT` points -- the k-th right
axis (Y2 counts when the figure has one) sits ``k * SLOT_PT`` outside the
frame, exactly the slot geometry the canvas gives it. Each draws its own
series (lines, markers, fills, error bars, drop lines) through the SAME
:func:`quantized.calc.figure_y2.draw_secondary_axes` the Y2 axis uses, then
its own range, scale, number format, title and colour.

What an extra axis refuses is stripped by the client (crossing, breaks, the
axis offset, per-axis grid, a top axis) and ignored here: the axis-look
helper is handed a format without ``offset``/``cross``/``grid`` so it can
never move the slot position. A ``$`` in its title is escaped -- the canvas
draws extra-axis titles as plain text, so the export must too.

Pure layer: no fastapi/pydantic imports. Reached lazily from
``figure_y2.render_with_secondary_axis`` only when ``extra_y`` is non-empty.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.axis_style import apply_axis_style
from quantized.calc.figure_marks import DropLine, apply_drop_lines, collect_drop
from quantized.calc.figure_scale import drawable_lim
from quantized.calc.figure_styles import FigureStyle

__all__ = ["SLOT_PT", "draw_extra_axes"]

#: One right-axis slot, points -- ``frontend/src/lib/multiY.ts``'s
#: ``MULTI_Y_SLOT_PT`` (the screen draws it as ``ptToPx``).
SLOT_PT = 60.0

_LOOK_DROP = ("offset", "cross", "grid", "top", "breaks", "rotate")

DrawAxis = Callable[..., list[Any]]


def _look(fmt: Mapping[str, Any] | None) -> dict[str, Any] | None:
    return None if not fmt else {k: v for k, v in fmt.items() if k not in _LOOK_DROP}


def _colour(ax: Any, color: str) -> None:
    ax.spines["right"].set_color(color)
    ax.tick_params(axis="y", which="both", colors=color)
    ax.yaxis.label.set_color(color)


def draw_extra_axes(
    fig: Any,
    ax: Any,
    xv: NDArray[np.float64],
    subsets: Sequence[
        tuple[
            Mapping[str, Any],
            list[tuple[str, ArrayLike]],
            list[Mapping[str, Any] | None] | None,
            list[Any],
        ]
    ],
    *,
    st: FigureStyle,
    first_slot: int,
    color_offset: int,
    minor_ticks: bool,
    draw_axis: DrawAxis,
) -> list[tuple[Any, list[Any]]]:
    """Draw each ``(axis spec, series, styles, error spans)`` subset on a new
    twin of ``ax``, slot ``first_slot + i``. Returns each ``(axes, artists)``
    in order. ``draw_axis`` is ``figure_y2.draw_secondary_axes``."""
    out: list[tuple[Any, list[Any]]] = []
    offset = color_offset
    for i, (spec, series, styles, spans) in enumerate(subsets):
        axk = ax.twinx()
        label = str(spec.get("label") or "").replace("$", r"\$")
        artists = draw_axis(
            fig,
            axk,
            xv,
            series,
            st=st,
            series_styles=styles,
            y_scale=spec.get("scale"),
            y_label=label,
            y_fmt=spec.get("fmt"),
            y_step=spec.get("step"),
            color_offset=offset,
            minor_ticks=minor_ticks,
            error_spans=spans,
        )
        offset += len(series)
        axk.spines["right"].set_visible(True)
        axk.spines["right"].set_position(("outward", SLOT_PT * (first_slot + i)))
        lim = spec.get("lim")
        if lim is not None:
            axk.set_ylim(*drawable_lim(axk, "y", float(lim[0]), float(lim[1])))
        apply_axis_style(axk, "y", _look(spec.get("fmt")), side="right", grid_alpha=st.grid_alpha)
        if spec.get("color"):
            _colour(axk, str(spec["color"]))
        drops: list[DropLine] = []
        for (_, y), sty, art in zip(series, styles or [None] * len(series), artists, strict=False):
            collect_drop(drops, xv, np.asarray(y, dtype=float), sty, art.get_color())
        apply_drop_lines(axk, drops)
        out.append((axk, artists))
    return out
