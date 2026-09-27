"""Category-axis label styling for categorical publication figures (P2.6 box 1).

PRIMARY_SOFTWARE_AUDIT_PLAN P2.6, "nested grouping / order / labels". Pure
matplotlib helpers shared by ``figure_statplots`` (box / violin / strip),
``figure_categorical`` (bars) and ``figure_facets`` (their grids), mirroring
the interactive Canvas stage's ``statRenderAxes.ts`` so that the same request
draws the same axis in both places:

* :func:`wrap_label` -- greedy word wrap to ``width`` characters, a word longer
  than that hard-split, at most :data:`MAX_WRAP_LINES` lines (the last one
  ellipsized when text is left over). ``lib/statMarks.wrapLabel`` is the
  line-for-line twin; the shared cases in ``tests/test_calc_figure_stat_marks``
  and ``statMarks.test.ts`` hold them together.
* :func:`nested_tiers` -- a NESTED axis (every label ``A = a / B = b``) split
  into its inner tick labels and the runs of equal outer levels.
* :func:`style_category_axis` -- applies rotation (0 / 45 / 90), wrapping, and
  the two-tier nested layout: inner labels at the ticks, each outer level
  centred once under its run on a second tier, and a separator between runs.
  With every option off it touches nothing -- byte-identical output.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from quantized.calc.figure_group_notes import NESTED_LABEL_SEP

__all__ = [
    "LABEL_ROTATIONS",
    "MAX_WRAP_LINES",
    "nested_tiers",
    "style_category_axis",
    "wrap_label",
]

LABEL_ROTATIONS = (0, 45, 90)
MAX_WRAP_LINES = 3
_ELLIPSIS = "…"
_SEPARATOR = "0.45"


def wrap_label(text: str, width: int, max_lines: int = MAX_WRAP_LINES) -> list[str]:
    """Greedy word wrap of ``text`` to lines of at most ``width`` characters
    (code points). Words are split on single spaces; a word longer than
    ``width`` is hard-split. More than ``max_lines`` lines keep the first
    ``max_lines`` and end the last with an ellipsis. Never returns an empty
    list (an empty label is one empty line)."""
    width = max(1, int(width))
    lines: list[str] = []
    cur = ""
    for word in text.split(" "):
        if not word:
            continue
        while len(word) > width:
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(word[:width])
            word = word[width:]
        if not word:
            continue
        if not cur:
            cur = word
        elif len(cur) + 1 + len(word) <= width:
            cur = f"{cur} {word}"
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    if not lines:
        return [""]
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        lines[-1] = (last[: width - 1] if len(last) >= width else last) + _ELLIPSIS
    return lines


def nested_tiers(labels: Sequence[str]) -> tuple[list[str], list[tuple[str, int, int]]] | None:
    """``(inner, runs)`` for a nested axis, or ``None`` unless EVERY label is
    nested. ``inner[i]`` is label i's second half; ``runs`` lists each maximal
    run of equal outer halves as ``(outer, first, last)`` slot indices, in
    axis order. An empty slot's label is nested like any other, so a missing
    combination stays inside its outer level's run."""
    inner: list[str] = []
    outers: list[str] = []
    for label in labels:
        i = label.find(NESTED_LABEL_SEP)
        if i < 0:
            return None
        outers.append(label[:i])
        inner.append(label[i + len(NESTED_LABEL_SEP):])
    if not inner:
        return None
    runs: list[tuple[str, int, int]] = []
    for i, outer in enumerate(outers):
        if runs and runs[-1][0] == outer:
            runs[-1] = (outer, runs[-1][1], i)
        else:
            runs.append((outer, i, i))
    return inner, runs


def _label_depth_pt(labels: Sequence[str], rotation: int, fontsize: float) -> float:
    """How far below the axis line the (possibly wrapped / rotated) tick
    labels reach, in points -- where the outer tier starts. An estimate from
    character counts (the renderer's own text metrics are not available
    before the draw); the tick length + pad matplotlib puts above the first
    line are included."""
    lines = [s.split("\n") for s in labels] or [[""]]
    pad = 3.5 + 3.5 + 2.0
    if rotation == 0:
        return pad + max(len(ls) for ls in lines) * fontsize * 1.25
    longest = max(len(line) for ls in lines for line in ls)
    theta = math.radians(rotation)
    tall = max(len(ls) for ls in lines) * fontsize * 1.25
    return pad + longest * fontsize * 0.6 * math.sin(theta) + tall * math.cos(theta)


def style_category_axis(
    ax: Any,
    ticks: Sequence[float],
    labels: Sequence[str],
    *,
    rotation: int = 0,
    wrap: int | None = None,
    tiered: bool = False,
) -> Any | None:
    """Apply the category-axis options to ``ax`` (whose ticks sit at
    ``ticks``, labelled ``labels``). Returns the outer-tier secondary axis
    when the two-tier nested layout was drawn -- the caller puts the x TITLE
    on it so the title clears the second tier -- else ``None``.

    ``tiered`` only takes effect when every label is nested
    (:func:`nested_tiers`); a flat axis ignores it."""
    if rotation not in LABEL_ROTATIONS:
        raise ValueError(f"label rotation must be one of {LABEL_ROTATIONS}")
    tiers = nested_tiers(labels) if tiered else None
    if tiers is None and not wrap and not rotation:
        return None
    inner = tiers[0] if tiers else [str(s) for s in labels]
    if wrap:
        inner = ["\n".join(wrap_label(s, wrap)) for s in inner]
    ax.set_xticks(list(ticks))
    ax.set_xticklabels(inner)
    if rotation:
        for text in ax.get_xticklabels():
            text.set_rotation(rotation)
            text.set_horizontalalignment("right" if rotation == 45 else "center")
            text.set_rotation_mode("anchor" if rotation == 45 else "default")
    if tiers is None:
        return None
    runs = tiers[1]
    tick_labels = ax.get_xticklabels()
    fontsize = float(tick_labels[0].get_fontsize()) if tick_labels else 10.0
    depth = _label_depth_pt(inner, rotation, fontsize)
    outer = ax.secondary_xaxis("bottom")
    outer.spines["bottom"].set_position(("outward", depth))
    outer.spines["bottom"].set_visible(False)
    # Separators: major ticks at each run boundary, pointing UP through the
    # inner-label band to the axis line.
    bounds = [(ticks[last] + ticks[last + 1]) / 2 for _, _, last in runs[:-1]]
    outer.set_xticks(bounds)
    outer.set_xticklabels([""] * len(bounds))
    outer.tick_params(
        axis="x", which="major", direction="in", length=depth, width=0.8, color=_SEPARATOR,
    )
    # The outer level, once, centred under its run.
    centers = [(ticks[first] + ticks[last]) / 2 for _, first, last in runs]
    outer.set_xticks(centers, minor=True)
    outer.set_xticklabels([r[0] for r in runs], minor=True)
    outer.tick_params(axis="x", which="minor", length=0)
    return outer
