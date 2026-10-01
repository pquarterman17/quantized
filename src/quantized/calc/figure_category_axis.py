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
* :func:`fit_category_labels` -- the long-label leftover: with neither a
  rotation nor a wrap chosen (``fit="auto"`` on the wire), a label wider than
  its slot wraps, or rotates when it cannot wrap. ONE rule with the canvas
  (``lib/statMarks.fitCategoryLabels``), pinned by
  ``tests/fixtures/wire/stat_label_fit.json``; each side applies it over its
  OWN text metrics and slot pitch (here matplotlib's renderer, in points),
  so a label that would overlap its neighbour in the figure is the one that
  turns in the figure. The same metrics measure a rotated label's depth
  (where the outer tier starts) instead of estimating it from character
  counts.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

import matplotlib as mpl
from matplotlib.font_manager import FontProperties

from quantized.calc.figure_group_notes import NESTED_LABEL_SEP
from quantized.calc.figure_labels import safe_mathtext_label

__all__ = [
    "LABEL_ROTATIONS",
    "LABEL_WRAP_WIDTH",
    "MAX_WRAP_LINES",
    "fit_category_labels",
    "nested_tiers",
    "style_category_axis",
    "wrap_label",
]

LABEL_ROTATIONS = (0, 45, 90)
MAX_WRAP_LINES = 3
#: Characters per wrapped line (``lib/statMarks.LABEL_WRAP_WIDTH``) -- what
#: ``fit_category_labels`` wraps at; the wire's ``wrap`` carries it explicitly.
LABEL_WRAP_WIDTH = 12
_FITS = (None, "auto")
_ELLIPSIS = "…"
_SEPARATOR = "0.45"


def _pack_words(words: Sequence[str], width: int, max_lines: int) -> list[str]:
    """The greedy line-packing half of :func:`wrap_label`, factored out so
    :func:`_wrap_label_axis` (P2.6 review finding 8) can feed it MATH-SPAN-
    preserving tokens instead of a naive ``text.split(" ")`` -- never
    breaking a raw ``$...$`` region onto two lines. :func:`wrap_label`
    itself (the frontend-shared, fixture-pinned function,
    ``lib/statMarks.wrapLabel``'s twin) is UNCHANGED by this: it is this
    same algorithm, over the same plain-space-split words, byte-identical."""
    lines: list[str] = []
    cur = ""
    for word in words:
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


def wrap_label(text: str, width: int, max_lines: int = MAX_WRAP_LINES) -> list[str]:
    """Greedy word wrap of ``text`` to lines of at most ``width`` characters
    (code points). Words are split on single spaces; a word longer than
    ``width`` is hard-split. More than ``max_lines`` lines keep the first
    ``max_lines`` and end the last with an ellipsis. Never returns an empty
    list (an empty label is one empty line)."""
    return _pack_words(text.split(" "), max(1, int(width)), max_lines)


def _split_words_keep_math(text: str) -> list[str]:
    """Split on spaces like ``text.split(" ")``, except a raw ``$...$`` span
    -- even one containing a space -- is kept as ONE token, so the greedy
    packer above can never break it across two lines. An odd number of
    ``$`` (no genuine closed span) falls back to a plain split, mirroring
    ``safe_mathtext_label``'s own "odd count -> literal, not math" reading."""
    if text.count("$") % 2 == 1:
        return text.split(" ")
    words: list[str] = []
    cur = ""
    in_math = False
    for ch in text:
        if ch == "$":
            in_math = not in_math
            cur += ch
        elif ch == " " and not in_math:
            words.append(cur)
            cur = ""
        else:
            cur += ch
    words.append(cur)
    return words


def _wrap_label_axis(text: str, width: int, max_lines: int = MAX_WRAP_LINES) -> list[str]:
    """P2.6 review finding 8 -- the category-axis wrap: the SAME greedy
    packing as :func:`wrap_label`, over MATH-SPAN-preserving tokens
    (:func:`_split_words_keep_math`) instead of a plain space split, so a
    raw ``$...$`` region is never split across two lines. Called on the RAW
    label (before ``safe_mathtext_label`` escaping changes its character
    count); each returned line is still raw -- the caller sanitizes once,
    per line, right before display."""
    return _pack_words(_split_words_keep_math(text), max(1, int(width)), max_lines)


def _runs_from_outers(outers: Sequence[str]) -> list[tuple[str, int, int]]:
    """Each maximal run of equal outer halves as ``(outer, first, last)``
    slot indices, in axis order -- shared by both the explicit-``tiers`` path
    and the legacy string-split path below, so the two can never disagree
    about how runs are grouped once the (outer, inner) pairs are known."""
    runs: list[tuple[str, int, int]] = []
    for i, outer in enumerate(outers):
        if runs and runs[-1][0] == outer:
            runs[-1] = (outer, runs[-1][1], i)
        else:
            runs.append((outer, i, i))
    return runs


def nested_tiers(labels: Sequence[str]) -> tuple[list[str], list[tuple[str, int, int]]] | None:
    """``(inner, runs)`` for a nested axis, or ``None`` unless EVERY label is
    nested. ``inner[i]`` is label i's second half; ``runs`` lists each maximal
    run of equal outer halves as ``(outer, first, last)`` slot indices, in
    axis order. An empty slot's label is nested like any other, so a missing
    combination stays inside its outer level's run.

    P2.6 review finding 4: whether an axis IS nested must be decided
    STRUCTURALLY by the caller (:func:`style_category_axis`'s ``tiered``,
    from whether a nest column is active) -- this only splits the STRING once
    that is already known. It still finds the FIRST ``NESTED_LABEL_SEP`` in
    each label, which is exactly right for the request's own labels (built
    from a fixed ``"{outer} = {level} / {inner} = {level}"`` convention that
    never repeats the separator before the inner half) but can mis-split an
    outer level whose own text happens to contain ``" / "`` -- callers that
    already know the split (``style_category_axis``'s explicit ``tiers``,
    populated by the frontend's `lib/statMarks.nestedTiers`, which finds the
    split at the NEST COLUMN's own marker instead) bypass this entirely."""
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
    return inner, _runs_from_outers(outers)


def fit_category_labels(
    labels: Sequence[str],
    rotation: int,
    wrap: bool,
    measure: Callable[[str], float],
    pitch: float,
    line_height: float,
) -> tuple[int, bool]:
    """``(rotation, wrap)`` for these tick labels -- the wrap-or-rotate rule
    (module doc), the twin of ``lib/statMarks.fitCategoryLabels``. An
    explicit ``rotation`` or ``wrap`` is the caller's and comes back
    untouched. Otherwise, in ONE unit (``measure``, ``pitch`` and
    ``line_height``): every label no wider than its slot stays upright;
    else, when every label wraps (:func:`wrap_label`, :data:`LABEL_WRAP_WIDTH`)
    within :data:`MAX_WRAP_LINES` uncut AND every wrapped line fits the slot,
    wrapped; else rotated -- 45 when the pitch keeps 45-degree lines a line
    height apart (``pitch >= line_height * sqrt 2``), 90 otherwise."""
    if rotation or wrap:
        return rotation, wrap
    if not labels or max(measure(s) for s in labels) <= pitch:
        return 0, False

    def wraps(s: str) -> bool:
        lines = wrap_label(s, LABEL_WRAP_WIDTH, MAX_WRAP_LINES + 1)
        return len(lines) <= MAX_WRAP_LINES and all(measure(ln) <= pitch for ln in lines)

    if all(wraps(s) for s in labels):
        return 0, True
    return (45 if pitch >= line_height * math.sqrt(2) else 90), False


def _axis_metrics(ax: Any, n_slots: int) -> tuple[Callable[[str], float], float, float]:
    """``(measure, font size, slot pitch)`` for ``ax``'s tick labels, all in
    points, from the figure's OWN renderer (``Figure._get_renderer``: the Agg
    renderer ``new_figure`` attaches, or the one matplotlib makes for a bare
    ``Figure``) -- ``measure(text)`` is that renderer's width for the tick
    font, so a label's width is the width it is typeset at. The pitch is the
    axes' current width over the slot count: before the caller's
    ``tight_layout``, which only ever shrinks it (slightly over-estimated,
    so a label the rule keeps upright is one that fit BEFORE the y labels
    took their share). Without a renderer, the 0.6 em estimate."""
    fig = ax.figure
    prop = FontProperties(size=mpl.rcParams["xtick.labelsize"])
    size = float(prop.get_size_in_points())
    get = getattr(fig, "_get_renderer", None)
    renderer = get() if callable(get) else None
    if renderer is None:
        width = float(ax.get_position().width * fig.get_figwidth() * 72.0)
        return (lambda s: len(s) * size * 0.6), size, width / max(1, n_slots)
    scale = 72.0 / float(fig.dpi)

    def measure(text: str) -> float:
        return float(renderer.get_text_width_height_descent(text, prop, False)[0]) * scale

    return measure, size, float(ax.get_window_extent(renderer).width) * scale / max(1, n_slots)


def _label_depth_pt(
    labels: Sequence[str], rotation: int, fontsize: float, measure: Callable[[str], float],
) -> float:
    """How far below the axis line the (possibly wrapped / rotated) tick
    labels reach, in points -- where the outer tier starts. The widest line
    is MEASURED (``measure``, the renderer's own width for the tick font);
    the tick length + pad matplotlib puts above the first line are
    included."""
    lines = [s.split("\n") for s in labels] or [[""]]
    pad = 3.5 + 3.5 + 2.0
    if rotation == 0:
        return pad + max(len(ls) for ls in lines) * fontsize * 1.25
    longest = max(measure(line) for ls in lines for line in ls)
    theta = math.radians(rotation)
    tall = max(len(ls) for ls in lines) * fontsize * 1.25
    return pad + longest * math.sin(theta) + tall * math.cos(theta)


def style_category_axis(
    ax: Any,
    ticks: Sequence[float],
    labels: Sequence[str],
    *,
    rotation: int = 0,
    wrap: int | None = None,
    tiered: bool = False,
    tiers: Sequence[Sequence[str]] | None = None,
    raw_labels: Sequence[str] | None = None,
    fit: str | None = None,
) -> Any | None:
    """Apply the category-axis options to ``ax`` (whose ticks sit at
    ``ticks``, labelled ``labels``). Returns the outer-tier secondary axis
    when the two-tier nested layout was drawn -- the caller puts the x TITLE
    on it so the title clears the second tier -- else ``None``.

    ``fit="auto"`` (the long-label leftover): with ``rotation`` 0 and no
    ``wrap``, :func:`fit_category_labels` decides them over this figure's
    own text metrics and slot pitch (:func:`_axis_metrics`); a set that
    fits upright leaves the axis untouched exactly as before. ``None`` (a
    legacy request) applies the options as given.

    ``tiered`` only takes effect when every label is nested; a flat axis
    ignores it. P2.6 review finding 4: ``tiers`` (``[[outer, inner], ...]``,
    one pair per label, from the request's own ``axis_style.tiers``) is the
    PREFERRED way to say so -- the frontend already knows the exact split
    (`lib/statMarks.nestedTiers`, cut at the nest column's own marker rather
    than the first ``" / "`` in the string), so using it here means this
    module never re-derives a possibly-wrong split for an outer level whose
    own text contains ``" / "``. Omitted/``None`` falls back to
    :func:`nested_tiers`'s string split, gated by ``tiered`` alone (a legacy
    request, or a faceted panel, which has no per-panel ``tiers`` slot yet).

    ``raw_labels`` (P2.6 review finding 8, optional, parallel to ``labels``):
    the labels BEFORE the caller's own ``safe_mathtext_label`` escaping.
    Wrapping measures and splits ``raw_labels`` when given (never
    ``labels``): escaping a bare ``$`` to ``\\$`` changes its character
    count, so wrapping the ALREADY-escaped string would pick different
    break points than the canvas's ``lib/statMarks.wrapLabel`` -- fed the
    raw text to begin with, since the screen never escapes -- chooses for
    the identical label, and a raw ``$...$`` span (even one containing a
    space) is never split across two lines (:func:`_wrap_label_axis`).
    Every displayed line -- wrapped or not, inner tier or outer -- is
    sanitized exactly ONCE, right before it reaches ``ax``, off whichever
    of ``raw_labels``/``labels`` fed it: never before wrapping, so wrapping
    always sees the true character count. Omitted (``None``) falls back to
    ``labels`` for the wrap too, byte-identical to before this fix."""
    if rotation not in LABEL_ROTATIONS:
        raise ValueError(f"label rotation must be one of {LABEL_ROTATIONS}")
    if fit not in _FITS:
        raise ValueError(f"label fit must be one of {_FITS}")
    raw = [str(s) for s in raw_labels] if raw_labels is not None else [str(s) for s in labels]
    if tiers is not None:
        pairs = [(str(o), str(i)) for o, i in tiers]
        resolved = (
            ([p[1] for p in pairs], _runs_from_outers([p[0] for p in pairs])) if pairs else None
        )
    else:
        resolved = nested_tiers(raw) if tiered else None
    tiers_result = resolved
    inner_raw = tiers_result[0] if tiers_result else raw
    measure: Callable[[str], float] | None = None
    if fit == "auto" and not rotation and not wrap:
        measure, size, pitch = _axis_metrics(ax, len(ticks))
        rotation, do_wrap = fit_category_labels(inner_raw, 0, False, measure, pitch, size * 1.25)
        wrap = LABEL_WRAP_WIDTH if do_wrap else None
    if tiers_result is None and not wrap and not rotation:
        return None
    if wrap:
        wrapped = (_wrap_label_axis(s, wrap) for s in inner_raw)
        inner = ["\n".join(safe_mathtext_label(ln) for ln in lns) for lns in wrapped]
    else:
        inner = [safe_mathtext_label(s) for s in inner_raw]
    ax.set_xticks(list(ticks))
    ax.set_xticklabels(inner)
    if rotation:
        for text in ax.get_xticklabels():
            text.set_rotation(rotation)
            text.set_horizontalalignment("right" if rotation == 45 else "center")
            text.set_rotation_mode("anchor" if rotation == 45 else "default")
    if tiers_result is None:
        return None
    runs = tiers_result[1]
    tick_labels = ax.get_xticklabels()
    fontsize = float(tick_labels[0].get_fontsize()) if tick_labels else 10.0
    if measure is None:
        measure = _axis_metrics(ax, len(ticks))[0]
    depth = _label_depth_pt(inner, rotation, fontsize, measure)
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
    # Review finding 8: the outer tier's own text was never sanitized before
    # (a latent gap, not this finding's own bug) -- fixed here alongside it,
    # since `runs` is now built from the SAME raw pipeline either way.
    outer.set_xticklabels([safe_mathtext_label(r[0]) for r in runs], minor=True)
    outer.tick_params(axis="x", which="minor", length=0)
    return outer
