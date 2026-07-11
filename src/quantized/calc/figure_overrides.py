"""Figure property overrides (gap #11). Split out of ``calc.figure`` purely to
stay under the 500-line god-module ceiling (the same reason ``figure_break.py``
and ``figure_labels.py`` exist separately) -- the behavioural contract is still
``calc.figure``'s; ``_render_impl`` calls ``_validate_overrides`` up front and
``draw_series_axes`` calls ``_apply_overrides`` as its last step. Pure layer:
mapping in -> mutates the passed matplotlib Figure/Axes, no return value.

The one config object behind the property panels: every export property the
UI exposes lands in ``overrides``, patching the preset per-figure. Plain dict
(calc stays pydantic-free); unknown keys are ignored so old clients keep
working.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from quantized.calc.figure_labels import safe_mathtext_label

__all__ = ["_apply_overrides", "_validate_overrides"]

_LEGEND_LOCS = frozenset({
    "best", "upper right", "upper left", "lower left", "lower right",
    "right", "center left", "center right", "lower center", "upper center",
    "center", "outside right", "outside top", "custom",
})


def _validate_overrides(ov: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` on invalid override values (bad keys are ignored)."""
    legend = ov.get("legend")
    if legend is not None:
        loc = legend.get("loc")
        if loc is not None and loc not in _LEGEND_LOCS:
            raise ValueError(f"legend loc must be one of {sorted(_LEGEND_LOCS)}")
    ticks = ov.get("ticks")
    if ticks is not None:
        tdir = ticks.get("dir")
        if tdir is not None and tdir not in ("in", "out"):
            raise ValueError("ticks dir must be 'in' or 'out'")
    for key in ("x_lim", "y_lim"):
        lim = ov.get(key)
        if lim is not None and (not isinstance(lim, (list, tuple)) or len(lim) != 2):
            raise ValueError(f"{key} must be a [lo, hi] pair (null member = auto)")
    margins = ov.get("margins")
    if margins is not None:
        for side in ("left", "right", "top", "bottom"):
            v = margins.get(side)
            if v is not None and not 0.0 <= float(v) <= 1.0:
                raise ValueError("margins are figure fractions in [0, 1]")
    breaks = ov.get("x_breaks")
    if breaks is not None:
        if not isinstance(breaks, (list, tuple)) or len(breaks) == 0:
            raise ValueError("x_breaks must be a non-empty list of [lo, hi] pairs")
        prev_hi: float | None = None
        for b in breaks:
            if not isinstance(b, (list, tuple)) or len(b) != 2:
                raise ValueError("each x_breaks entry must be a [lo, hi] pair")
            lo, hi = float(b[0]), float(b[1])
            if not lo < hi:
                raise ValueError("each x_breaks entry must have lo < hi")
            if prev_hi is not None and lo < prev_hi:
                raise ValueError("x_breaks entries must be sorted and non-overlapping")
            prev_hi = hi


def _apply_overrides(
    fig: Any, ax: Any, st: Any, ov: Mapping[str, Any], *, n_series: int
) -> None:
    """Apply the post-plot override properties (legend / ticks / spines /
    limits / margins / grid / annotations). rc-level properties (fonts, tick
    direction/length) are folded into the rc context by the caller."""
    legend = ov.get("legend")
    if legend is not None:
        show = legend.get("show")
        if (show is None and n_series > 1) or show:
            frame = bool(legend.get("frame", st.legend_box))
            loc = str(legend.get("loc", "best"))
            kw: dict[str, Any] = {"frameon": frame, "fontsize": st.legend_font_size}
            if loc == "outside right":
                kw.update(loc="center left", bbox_to_anchor=(1.02, 0.5))
            elif loc == "outside top":
                kw.update(loc="lower center", bbox_to_anchor=(0.5, 1.02), ncols=max(1, n_series))
            elif loc == "custom":
                # #14 drag-to-place: anchor is a figure-fraction (fx, fy).
                anchor = legend.get("anchor") or (0.5, 0.5)
                kw.update(
                    loc="center",
                    bbox_to_anchor=(float(anchor[0]), float(anchor[1])),
                    bbox_transform=fig.transFigure,
                )
            else:
                kw["loc"] = loc
            ax.legend(**kw)
        elif ax.get_legend() is not None:
            ax.get_legend().remove()

    ticks = ov.get("ticks")
    if ticks is not None and ticks.get("minor"):
        ax.minorticks_on()

    spines = ov.get("spines")
    if spines is not None:
        for side in ("top", "right", "left", "bottom"):
            if side in spines:
                ax.spines[side].set_visible(bool(spines[side]))

    for key, setter in (("x_lim", ax.set_xlim), ("y_lim", ax.set_ylim)):
        lim = ov.get(key)
        if lim is not None:
            lo, hi = lim
            setter(
                None if lo is None else float(lo),
                None if hi is None else float(hi),
            )

    if "grid" in ov:
        ax.grid(bool(ov["grid"]), alpha=st.grid_alpha or 0.3)

    for ann in ov.get("annotations", []):
        # MAIN #18: a per-annotation `size` (the pointer tool's corner-handle
        # font-size resize, screen px) wins over the property panel's global
        # font_size override -- matches the screen, where each annotation's
        # OWN size (Annotation.size) always overrides the plot's base font.
        size = ann.get("size")
        ax.annotate(
            safe_mathtext_label(str(ann.get("text", ""))),
            xy=(float(ann.get("x", 0.0)), float(ann.get("y", 0.0))),
            fontsize=float(size) if size else float(ov.get("font_size", st.font_size)),
        )

    margins = ov.get("margins")
    if margins is not None:
        fig.subplots_adjust(
            left=margins.get("left"),
            right=None if margins.get("right") is None else 1.0 - float(margins["right"]),
            top=None if margins.get("top") is None else 1.0 - float(margins["top"]),
            bottom=margins.get("bottom"),
        )
