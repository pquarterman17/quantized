"""Marginal plots: a scatter with the distribution of each axis drawn beside it.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Pure numpy; the
distributions come from the primitives the Stat Stage already uses
(``statplots.histogram``, ``statplots.box_stats``, ``statplots_cdf.rug_ticks``),
so a marginal is exactly the histogram / box / rug a one-column plot of the same
values would show. The canvas painter (``frontend/src/lib/statMarginal.ts``) and
the matplotlib export (``calc.figure_dist2``) both draw :func:`marginal_geometry`,
pinned by ``tests/fixtures/wire/stat_marginal.json``.

Conventions, each stated once here:

- **Points.** A point needs BOTH coordinates finite; a row with either missing
  is dropped from the scatter AND from both marginals, so the three panels
  always describe the same rows.
- **Domain.** Each axis spans its finite range padded by 5 % (a constant column
  gets +-0.5), the rule the CDF plot uses. The marginal strips share it.
- **Layout.** The top strip is ``MARGINAL_RATIO`` of the plot's height, the
  right strip that fraction of its width, with a ``MARGINAL_GAP`` gap, all
  measured against the whole plot area. The canvas and the export use the same
  fractions.
- **Strip coordinates.** Along the strip the axis is data units; across it the
  value runs 0..1 from the edge touching the scatter outward. A histogram bar is
  as tall as ``HIST_PEAK * count / max count``, a box spans ``BOX_BAND``, and a
  rug tick spans ``RUG_BAND``.

Opt-in encodings (item 20; ``marginal_series`` with ``group`` / ``color`` / ``size``).
Without them the result and the geometry are exactly the ones above.

- **Group split.** ``group`` is one non-negative integer per row. Every strip then
  draws ONE distribution per group instead of the pooled one: histogram bars on the
  POOLED bin edges (so the groups are comparable and sum to the pooled counts) with one
  shared peak (the tallest bar of any group is ``HIST_PEAK``); a box or a rug in its own
  slot, the strip's cross axis split into ``n_groups`` equal slots (one group is the
  ordinary band). Point ``k`` carries ``point_group[k]``; the renderers colour group
  ``g`` with palette entry ``g``.
- **Colour-by / size-by.** A numeric column per row. Colour maps linearly over the kept
  rows' finite range through the screen's gradient (``figure_colorscatter.gradient_colors``);
  size maps the marker diameter over the same kind of range onto ``DEFAULT_SIZE_RANGE``
  (``lib/sizescatter.sizeDiameter``). A group split and a colour column both colour the
  points, so asking for both is refused.
- **Rows.** A row also needs a valid group id and a finite colour and size value to be
  kept; a row that is not leaves the scatter and every margin together, as before.
- **Key.** ``geometry["key"]`` names what the corner cell above the right strip shows:
  the (first ``KEY_GROUPS``) group names, the colour range and the size marks.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure_colorscatter import GRADIENT_STOPS, gradient_colors
from quantized.calc.figure_sizes import DEFAULT_SIZE_RANGE
from quantized.calc.statplots import box_stats, histogram
from quantized.calc.statplots_cdf import padded_domain, rug_ticks

__all__ = [
    "BOX_BAND",
    "HIST_PEAK",
    "MARGINAL_GAP",
    "MARGINAL_KINDS",
    "MARGINAL_RATIO",
    "KEY_GROUPS",
    "RUG_BAND",
    "marginal_geometry",
    "marginal_series",
]

MARGINAL_KINDS = ("histogram", "box", "rug")
MARGINAL_RATIO = 0.2
MARGINAL_GAP = 0.02
HIST_PEAK = 0.9
BOX_BAND = (0.25, 0.75)
RUG_BAND = (0.0, 0.5)
KEY_GROUPS = 5  # group names the corner key lists before "+ n more"


def _pairs(
    x: ArrayLike, y: ArrayLike
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    xs = np.asarray(x, dtype=float).ravel()
    ys = np.asarray(y, dtype=float).ravel()
    if xs.size != ys.size:
        raise ValueError("x and y must have the same number of values")
    keep = np.isfinite(xs) & np.isfinite(ys)
    return xs[keep], ys[keep]


def _distribution(values: NDArray[np.float64], kind: str, bins: str | int) -> dict[str, Any]:
    if kind == "histogram":
        h = histogram(values, bins=bins)
        return {"edges": h["edges"], "counts": h["counts"]}
    if kind == "box":
        b = box_stats(values)
        return {k: b[k] for k in ("q1", "median", "q3", "whislo", "whishi", "fliers")}
    return {}  # rug: the ticks are the points themselves


def _group_distribution(
    values: NDArray[np.float64], kind: str, pooled: dict[str, Any]
) -> dict[str, Any]:
    """One group's distribution of an axis: a histogram on the POOLED edges, a box, or
    nothing (rug); a group with no rows has none (``{}``) except an all-zero histogram."""
    if kind == "histogram":
        counts = np.histogram(values, bins=np.asarray(pooled["edges"]))[0]
        return {"edges": pooled["edges"], "counts": [float(c) for c in counts]}
    if kind == "box" and values.size:
        b = box_stats(values)
        return {k: b[k] for k in ("q1", "median", "q3", "whislo", "whishi", "fliers")}
    return {}


def _per_row(v: ArrayLike | None, n: int, what: str) -> NDArray[np.float64] | None:
    if v is None:
        return None
    a = np.asarray(v, dtype=float).ravel()
    if a.size != n:
        raise ValueError(f"{what} must have one value per (x, y) row")
    return a


def _numeric(z: NDArray[np.float64], label: str) -> dict[str, Any]:
    return {
        "z": [float(v) for v in z], "lo": float(z.min()), "hi": float(z.max()), "label": label,
    }


def marginal_series(
    x: ArrayLike,
    y: ArrayLike,
    *,
    kind: str = "histogram",
    bins: str | int = "fd",
    group: ArrayLike | None = None,
    group_labels: Sequence[str] | None = None,
    color: ArrayLike | None = None,
    color_label: str = "",
    size: ArrayLike | None = None,
    size_label: str = "",
) -> dict[str, Any]:
    """Everything a marginal plot of ``(x, y)`` draws: the complete finite
    pairs, each axis's padded domain and its marginal distribution (``edges`` /
    ``counts`` for a histogram, the five box numbers and fliers for a box,
    nothing for a rug). Needs at least two complete points.

    ``group`` / ``color`` / ``size`` (one value per input row) are the opt-in
    encodings of the module docstring; the result then also carries ``group``
    (+ ``n_groups``, ``group_labels`` and per-group ``marginals["groups"]``),
    ``color`` and ``size`` (each ``z`` / ``lo`` / ``hi`` / ``label``) for the kept rows."""
    if kind not in MARGINAL_KINDS:
        raise ValueError(f"marginal kind must be one of {MARGINAL_KINDS}")
    xa = np.asarray(x, dtype=float).ravel()
    ya = np.asarray(y, dtype=float).ravel()
    if xa.size != ya.size:
        raise ValueError("x and y must have the same number of values")
    g = _per_row(group, xa.size, "group")
    c = _per_row(color, xa.size, "color")
    z = _per_row(size, xa.size, "size")
    if g is not None and c is not None:
        raise ValueError("a group split and a colour column both colour the points: use one")
    keep = np.isfinite(xa) & np.isfinite(ya)
    for extra in (c, z):
        if extra is not None:
            keep &= np.isfinite(extra)
    n_groups = 0
    if g is not None:
        keep &= np.isfinite(g) & (g >= 0) & (g == np.floor(g))
        n_groups = (
            len(group_labels) if group_labels is not None else int(g[keep].max(initial=-1)) + 1
        )
        if keep.any() and int(g[keep].max()) >= n_groups:
            raise ValueError("a group id is past the last group label")
    xs, ys = xa[keep], ya[keep]
    if xs.size < 2:
        raise ValueError("a marginal plot needs at least 2 complete (x, y) points")
    out: dict[str, Any] = {
        "kind": kind,
        "n": int(xs.size),
        "x": [float(v) for v in xs],
        "y": [float(v) for v in ys],
        "domain": {"x": list(padded_domain([xs])), "y": list(padded_domain([ys]))},
        "marginals": {
            "x": _distribution(xs, kind, bins),
            "y": _distribution(ys, kind, bins),
        },
    }
    if g is not None:
        ids = g[keep].astype(int)
        out["group"] = [int(i) for i in ids]
        out["n_groups"] = n_groups
        out["group_labels"] = (
            [str(s) for s in group_labels] if group_labels is not None
            else [f"group {i + 1}" for i in range(n_groups)]
        )
        out["marginals"]["groups"] = {
            ax: [
                _group_distribution(v[ids == i], kind, out["marginals"][ax])
                for i in range(n_groups)
            ]
            for ax, v in (("x", xs), ("y", ys))
        }
    if c is not None:
        out["color"] = _numeric(c[keep], color_label)
    if z is not None:
        out["size"] = _numeric(z[keep], size_label)
    return out


def _strip(
    kind: str,
    m: dict[str, Any],
    values: list[float],
    slot: int = 0,
    n_slots: int = 1,
    top: float | None = None,
) -> dict[str, Any]:
    """One strip. ``slot`` / ``n_slots`` place a group's box or rug in its share of the
    cross axis (a group split); ``top`` is the histogram's shared tallest count."""
    if kind == "histogram":
        counts = m["counts"]
        peak = (top if top is not None else max(counts)) or 1.0
        edges = m["edges"]
        bars = [
            [edges[i], edges[i + 1], HIST_PEAK * counts[i] / peak] for i in range(len(counts))
        ]
        return {"kind": kind, "bars": bars}
    if kind == "box":
        out: dict[str, Any] = {
            "kind": kind,
            "box": [m["q1"], m["q3"]],
            "median": m["median"],
            "whiskers": [m["whislo"], m["whishi"]],
            "fliers": list(m["fliers"]),
        }
        if n_slots > 1:
            out["band"] = [(slot + BOX_BAND[0]) / n_slots, (slot + BOX_BAND[1]) / n_slots]
        return out
    length = RUG_BAND[1] - RUG_BAND[0]
    ticks = [list(t) for t in rug_ticks(values, 0, length)]
    if n_slots > 1:
        y0, y1 = (slot + RUG_BAND[0]) / n_slots, (slot + RUG_BAND[1]) / n_slots
        ticks = [[a, y0, y1] for a, _, _ in ticks]
    return {"kind": kind, "ticks": ticks}


def _group_strips(result: dict[str, Any], axis: str) -> list[dict[str, Any] | None]:
    """Per group the strip of ``axis`` (``None`` for a group with no row)."""
    kind, ids = result["kind"], result["group"]
    values = result[axis]
    dists = result["marginals"]["groups"][axis]
    n = result["n_groups"]
    top = (
        max((max(d["counts"]) for d in dists if d), default=0.0) if kind == "histogram" else None
    )
    out: list[dict[str, Any] | None] = []
    for i in range(n):
        mine = [v for v, gi in zip(values, ids, strict=True) if gi == i]
        out.append(_strip(kind, dists[i], mine, i, n, top) if mine else None)
    return out


def _size_mark(lo: float, hi: float, v: float) -> float:
    t = (v - lo) / (hi - lo) if hi > lo else 0.5
    return DEFAULT_SIZE_RANGE[0] + t * (DEFAULT_SIZE_RANGE[1] - DEFAULT_SIZE_RANGE[0])


def marginal_geometry(result: dict[str, Any]) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`marginal_series` result
    (or its JSON): the scatter ``points``, and per axis a strip in strip
    coordinates (see the module docstring). With a group split ``group_strips``
    (per axis, per group) replaces ``strips`` and ``point_group`` is added; a colour
    column adds per-point ``fills`` (hex), a size column per-point ``diameters`` and
    ``key`` describes the corner key."""
    kind = result["kind"]
    geo: dict[str, Any] = {
        "domain": result["domain"],
        "points": [[a, b] for a, b in zip(result["x"], result["y"], strict=True)],
    }
    key: dict[str, Any] = {}
    if "group" in result:
        geo["point_group"] = result["group"]
        geo["group_strips"] = {ax: _group_strips(result, ax) for ax in ("x", "y")}
        present = sorted(set(result["group"]))
        key["groups"] = {
            "ids": present[:KEY_GROUPS],
            "labels": [result["group_labels"][i] for i in present[:KEY_GROUPS]],
            "more": max(0, len(present) - KEY_GROUPS),
        }
    else:
        geo["strips"] = {
            "x": _strip(kind, result["marginals"]["x"], result["x"]),
            "y": _strip(kind, result["marginals"]["y"], result["y"]),
        }
    if "color" in result:
        c = result["color"]
        geo["fills"] = gradient_colors(np.asarray(c["z"]), c["lo"], c["hi"], GRADIENT_STOPS)
        key["color"] = {"label": c["label"], "lo": c["lo"], "hi": c["hi"]}
    if "size" in result:
        s = result["size"]
        geo["diameters"] = [_size_mark(s["lo"], s["hi"], v) for v in s["z"]]
        vals = [s["lo"], (s["lo"] + s["hi"]) / 2, s["hi"]] if s["hi"] > s["lo"] else [s["lo"]]
        key["size"] = {
            "label": s["label"], "lo": s["lo"], "hi": s["hi"],
            "marks": [[v, _size_mark(s["lo"], s["hi"], v)] for v in vals],
        }
    if key:
        geo["key"] = key
    return geo
