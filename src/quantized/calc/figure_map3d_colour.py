"""Colour for the 3-D bar and vector marks (``calc.figure_map3d_ext``).

Two opt-in request options, both off by default (off = the marks as before):

* ``vec_by_length`` -- colour each 3-D vector by its LENGTH, the magnitude
  ``|(dX, dY, dZ)|`` of its delta in DATA units (for end points: of ``end - tail``;
  the length scale ``vec_scale`` only stretches the drawn arrow, it does not
  change the number a colour stands for). The colour range is the drawn arrows'
  own extent (a flat range padded as every axis is), through the figure's
  colormap, with a colour bar titled ``LENGTH_LABEL``. The map's z colour limits
  never apply. Colouring by length and one fixed ``vec_color`` are two ways to
  colour: asking for both is refused.
* ``bar_cval`` / ``bar_group`` -- colour each 3-D bar from a COLUMN, one value per
  row (so the bars are the rows: ``contour_source='points'``). A number column
  (``bar_cval``) maps through the colormap over its own extent with a colour bar
  titled ``bar_cval_label``; a categorical column (``bar_group``: an index into
  ``bar_group_names``, at most ``MAX_GROUPS``) takes palette colours (the scatter's
  ``GROUP_COLORS``) and a legend titled ``bar_group_label``. A row with a gap in
  x, y, z or the colour column is not drawn. Numbers, categories and a fixed
  ``bar_color`` are mutually exclusive.

The interactive view (``frontend/src/components/Stage/Map3D/barColour3d.ts``,
``sceneExt3d.ts``) mirrors every rule here, pinned by
``tests/fixtures/wire/plot3d_kinds.json``. Pure; every refusal is a ``ValueError``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import matplotlib
import numpy as np
from matplotlib.colors import Normalize, to_rgba
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure_map3d_ext import padded_span
from quantized.calc.figure_map3d_scatter import GROUP_COLORS, MAX_GROUPS

__all__ = [
    "BAR_COLOUR_FIELDS",
    "LENGTH_LABEL",
    "BarColour",
    "bar_colour_active",
    "bar_face_colours",
    "check_vector_colouring",
    "coloured_bar_rows",
    "plan_bar_colour",
    "vector_colour_plan",
    "vector_colour_requested",
    "vector_colour_rows",
    "vector_colours",
    "vector_lengths",
]

LENGTH_LABEL = "Vector length"
BAR_COLOUR_FIELDS = ("bar_cval", "bar_group")
VECTOR_COLOUR_FIELDS = ("vec_cval", "vec_group")


def check_vector_colouring(opts: Mapping[str, Any]) -> bool:
    """Whether vectors are coloured by length; refuses length plus a fixed colour."""
    by_length = bool(opts.get("vec_by_length"))
    if by_length and opts.get("vec_color") is not None:
        raise ValueError(
            "colour vectors by length or with one fixed colour, not both: "
            "send vec_by_length or vec_color"
        )
    return by_length


def vector_lengths(
    tails: NDArray[np.float64], tips: NDArray[np.float64], scale: float
) -> NDArray[np.float64]:
    """Each drawn vector's length in data units: ``|tip - tail| / scale``, i.e. the
    magnitude of its delta before the length scale stretched it."""
    return np.asarray(np.linalg.norm(tips - tails, axis=1) / scale, dtype=np.float64)


def vector_colours(
    lengths: NDArray[np.float64], cmap_name: str
) -> tuple[NDArray[np.float64], Normalize]:
    """The RGBA of every vector (one row each) over the lengths' own extent, and
    the ``Normalize`` the colour bar shares."""
    lo, hi = padded_span(float(lengths.min()), float(lengths.max()))
    norm = Normalize(lo, hi)
    return np.asarray(matplotlib.colormaps[cmap_name](norm(lengths)), dtype=np.float64), norm


def vector_colour_requested(opts: Mapping[str, Any] | None) -> bool:
    """Whether a ``vectors3d`` request colours its arrows from a column."""
    e = opts or {}
    return any(e.get(k) is not None for k in VECTOR_COLOUR_FIELDS)


def vector_colour_rows(opts: Mapping[str, Any], n: int) -> NDArray[np.bool_]:
    """The request rows (of ``n``) whose colour value is usable: a finite number
    (``vec_cval``) or an index into ``vec_group_names`` (``vec_group``). Refuses a
    second colouring, a wrong length and more than ``MAX_GROUPS`` categories."""
    if opts.get("vec_cval") is not None and opts.get("vec_group") is not None:
        raise ValueError(
            "colour vectors by a column or by categories, not both: send vec_cval or vec_group"
        )
    if opts.get("vec_by_length") or opts.get("vec_color") is not None:
        raise ValueError(
            "colour vectors from a column, by length or with one fixed colour, not more than "
            "one: send vec_cval, vec_group, vec_by_length or vec_color"
        )
    if opts.get("vec_cval") is not None:
        vals = np.asarray([np.nan if v is None else v for v in opts["vec_cval"]], dtype=np.float64)
        if vals.size != n:
            raise ValueError(f"vec_cval must have one value per row ({n}), got {vals.size}")
        return np.asarray(np.isfinite(vals), dtype=np.bool_)
    g = opts["vec_group"]
    names = opts.get("vec_group_names") or []
    if len(g) != n:
        raise ValueError(f"vec_group must have one value per row ({n}), got {len(g)}")
    if not 1 <= len(names) <= MAX_GROUPS:
        raise ValueError(
            f"3-D vectors take 1 to {MAX_GROUPS} colour categories; this column has "
            f"{len(names)} (pick a column with fewer levels)"
        )
    raw = np.asarray([-1 if c is None else int(c) for c in g], dtype=np.intp)
    return np.asarray((raw >= 0) & (raw < len(names)), dtype=np.bool_)


def vector_colour_plan(opts: Mapping[str, Any], rows: NDArray[np.intp]) -> BarColour:
    """The colours of the drawn vectors (``rows``: the request rows that were
    drawn), in the bars' own plan type so one legend and one colour rule serve both."""
    names = [str(s) for s in (opts.get("vec_group_names") or [])]
    if opts.get("vec_cval") is not None:
        raw = np.asarray([np.nan if v is None else v for v in opts["vec_cval"]], dtype=np.float64)
        return BarColour(
            raw[rows], None, names, str(opts.get("vec_cval_label") or ""), "", 0
        )
    codes = np.asarray([-1 if c is None else int(c) for c in opts["vec_group"]], dtype=np.intp)
    return BarColour(None, codes[rows], names, "", str(opts.get("vec_group_label") or ""), 0)


@dataclass
class BarColour:
    """How the bars of a request are coloured from a column, rows aligned with the bars."""

    values: NDArray[np.float64] | None  # a number column (colour bar), else None
    codes: NDArray[np.intp] | None  # a categorical column (legend), else None
    names: list[str]
    label: str  # the colour bar's title (a number column)
    group_label: str  # the legend's title (a categorical column)
    dropped: int  # rows not drawn (a gap in x, y, z or the colour column)


def bar_colour_active(opts: Mapping[str, Any] | None) -> bool:
    """Whether a ``bars3d`` request colours its bars from a column."""
    e = opts or {}
    return any(e.get(k) is not None for k in BAR_COLOUR_FIELDS)


def plan_bar_colour(
    x: NDArray[np.float64], y: NDArray[np.float64], z: NDArray[np.float64],
    opts: Mapping[str, Any], *, source: str,
) -> tuple[NDArray[np.bool_], BarColour]:
    """The rows that draw a bar (finite x, y, z and a usable colour value) and
    their colours. ``x`` / ``y`` / ``z`` are the request's rows, unfiltered."""
    if source != "points":
        raise ValueError(
            "a bar colour column needs contour_source='points' (the bars are the rows)"
        )
    if opts.get("bar_cval") is not None and opts.get("bar_group") is not None:
        raise ValueError(
            "colour bars by a column or by categories, not both: send bar_cval or bar_group"
        )
    if opts.get("bar_color") is not None:
        raise ValueError(
            "colour bars from a column or with one fixed colour, not both: "
            "send bar_cval, bar_group or bar_color"
        )
    n = int(x.size)
    ok = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    values: NDArray[np.float64] | None = None
    codes: NDArray[np.intp] | None = None
    names = [str(s) for s in (opts.get("bar_group_names") or [])]
    if opts.get("bar_cval") is not None:
        raw_v = [np.nan if v is None else v for v in opts["bar_cval"]]
        values = np.asarray(raw_v, dtype=np.float64)
        if values.size != n:
            raise ValueError(f"bar_cval must have one value per row ({n}), got {values.size}")
        ok &= np.isfinite(values)
    else:
        g = opts["bar_group"]
        if len(g) != n:
            raise ValueError(f"bar_group must have one value per row ({n}), got {len(g)}")
        if not 1 <= len(names) <= MAX_GROUPS:
            raise ValueError(
                f"a 3-D bar plot takes 1 to {MAX_GROUPS} colour categories; this column has "
                f"{len(names)} (pick a column with fewer levels)"
            )
        raw = np.asarray([-1 if c is None else int(c) for c in g], dtype=np.intp)
        ok &= (raw >= 0) & (raw < len(names))
        codes = raw
    plan = BarColour(
        None if values is None else values[ok], None if codes is None else codes[ok], names,
        str(opts.get("bar_cval_label") or ""), str(opts.get("bar_group_label") or ""),
        int(n - ok.sum()),
    )
    return ok, plan


def coloured_bar_rows(
    x_axis: ArrayLike, y_axis: ArrayLike, z_values: ArrayLike | None,
    opts: Mapping[str, Any], *, source: str,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], BarColour]:
    """The drawn bars' anchors and tops, with their colours, from the request's rows."""
    if source == "points" and z_values is None:
        raise ValueError("z_values is required when contour_source='points'")
    x = np.asarray(x_axis, dtype=float).ravel()
    y = np.asarray(y_axis, dtype=float).ravel()
    z = np.asarray(z_values if z_values is not None else [], dtype=float).ravel()
    if source == "points" and not (x.size == y.size == z.size):
        raise ValueError(
            f"x_axis/y_axis/z_values must have the same length, got {x.size}/{y.size}/{z.size}"
        )
    keep, plan = plan_bar_colour(x, y, z, opts, source=source)
    return x[keep], y[keep], z[keep], plan


def bar_face_colours(
    plan: BarColour, cmap_name: str
) -> tuple[Any, Normalize | None]:
    """One colour per bar (before ``bar3d``'s shading) and the ``Normalize`` of a
    number column (None for categories, which have no colour scale). A number
    column spans its own extent, a flat one padded."""
    if plan.codes is not None:
        return [to_rgba(GROUP_COLORS[int(c)]) for c in plan.codes], None
    assert plan.values is not None
    lo, hi = padded_span(float(plan.values.min()), float(plan.values.max()))
    norm = Normalize(lo, hi)
    return matplotlib.colormaps[cmap_name](norm(plan.values)), norm


def used_categories(plan: BarColour) -> Sequence[int]:
    """The category indices that have a drawn bar, in order (the legend's rows)."""
    return [] if plan.codes is None else sorted({int(c) for c in plan.codes})
