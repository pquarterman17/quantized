"""Lollipop (dot) plots: one dot per category, joined to the baseline by a stem.

ORIGIN_FEATURE_GAP_PLAN item 20 (statistical plot types). Pure numpy. The canvas
painter (``frontend/src/lib/statLollipop.ts``) and the matplotlib export
(``calc.figure_dist3``) both draw :func:`lollipop_geometry`, pinned by
``tests/fixtures/wire/stat_lollipop.json``.

Conventions, each stated once here:

- **Value.** The mean or the median of a group's finite values (``stat``); a
  group with none is refused by number.
- **Order.** ``sort`` is ``"none"`` (the groups' own order), ``"asc"`` or
  ``"desc"``; ties keep the groups' own order, so the three languages agree.
- **Baseline.** The stems start at 0, so the Y domain always contains 0 and is
  padded by 5 % of its span on both sides (a span of 0 pads by 1).
- **Horizontal (dot chart).** With ``horizontal`` the categories run down the Y
  axis, the first of the sorted list at the TOP: dot ``k`` sits at y = n - 1 - k
  (``positions``), the stems run from x = 0 to the value, the X domain is the
  padded value range and the Y domain ``[-0.5, n - 0.5]``.
- **Whiskers.** Opt-in (``whisker``), for the MEAN only (a median has no standard error; asking
  for both is refused). ``sd`` is the sample standard deviation (``ddof=1``), ``sem`` is
  ``sd / sqrt(n)`` and ``ci`` the 95 % confidence interval of the mean,
  ``t(0.975, n - 1) * sem``; the whisker runs ``value -+ half`` through the dot. A group with
  one finite value has no spread: it gets no whisker (``half`` is None) and the legend says so.
  The Y (or X, horizontal) domain grows to hold the whiskers.
- **Positions.** Dot ``k`` of the sorted list sits at x = k, the X domain is
  ``[-0.5, n - 0.5]``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import ArrayLike
from scipy import stats as sps

__all__ = [
    "CAP_HALF", "LOLLIPOP_SORTS", "LOLLIPOP_STATS", "LOLLIPOP_WHISKERS", "lollipop_geometry",
    "lollipop_series",
]

LOLLIPOP_STATS = ("mean", "median")
LOLLIPOP_WHISKERS = ("none", "sd", "sem", "ci")
CAP_HALF = 0.15  # a whisker cap's half-length, in category spacings (both renderers)
_WHISKER_LEGEND = {"sd": "mean ± SD", "sem": "mean ± SEM", "ci": "mean ± 95 % CI"}
LOLLIPOP_SORTS = ("none", "asc", "desc")
_PAD = 0.05
_MAX_GROUPS = 500


def lollipop_series(
    groups: Sequence[ArrayLike], *, stat: str = "mean", sort: str = "none", whisker: str = "none"
) -> dict[str, Any]:
    """Each group's ``value`` and ``n`` (in the groups' own order) and the
    display ``order`` (indices into the groups, after sorting); with ``whisker`` also
    the ``whisker`` kind and each group's ``half`` width (None below two values)."""
    if whisker not in LOLLIPOP_WHISKERS:
        raise ValueError(f"whisker must be one of {LOLLIPOP_WHISKERS}")
    if whisker != "none" and stat != "mean":
        raise ValueError("whiskers are drawn for the mean only")
    if stat not in LOLLIPOP_STATS:
        raise ValueError(f"stat must be one of {LOLLIPOP_STATS}")
    if sort not in LOLLIPOP_SORTS:
        raise ValueError(f"sort must be one of {LOLLIPOP_SORTS}")
    if not 1 <= len(groups) <= _MAX_GROUPS:
        raise ValueError(f"a lollipop plot takes 1 to {_MAX_GROUPS} groups")
    values: list[float] = []
    counts: list[int] = []
    halves: list[float | None] = []
    for i, g in enumerate(groups):
        v = np.asarray(g, dtype=float).ravel()
        v = v[np.isfinite(v)]
        if v.size == 0:
            raise ValueError(f"group {i + 1} has no finite value")
        values.append(float(np.mean(v) if stat == "mean" else np.median(v)))
        counts.append(int(v.size))
        halves.append(_half_width(v, whisker))
    order = list(range(len(values)))
    if sort != "none":
        order.sort(key=lambda i: values[i], reverse=sort == "desc")  # stable both ways
    out: dict[str, Any] = {
        "stat": stat, "sort": sort, "values": values, "n": counts, "order": order,
    }
    if whisker != "none":
        out.update(whisker=whisker, half=halves)
    return out


def _half_width(v: Any, whisker: str) -> float | None:
    """The whisker's half-width for one group's finite values (None below two values)."""
    if whisker == "none" or v.size < 2:
        return None
    sd = float(np.std(v, ddof=1))
    if whisker == "sd":
        return sd
    sem = sd / float(np.sqrt(v.size))
    return sem if whisker == "sem" else float(sps.t.ppf(0.975, v.size - 1)) * sem


def lollipop_geometry(
    result: dict[str, Any], horizontal: bool = False, caps: bool = False
) -> dict[str, Any]:
    """The vertices each renderer draws, from a :func:`lollipop_series` result
    (or its JSON): the ``stems`` ([[k, 0], [k, v]]), the ``dots`` and both
    domains, in display order (``horizontal`` swaps the axes, see above). A result with
    ``half`` adds the ``whiskers`` (one segment per group that has one, display order) and
    the ``legend`` text that names them. ``caps`` (opt-in, needs whiskers) adds the ``caps``: a
    short bar across each whisker end, ``CAP_HALF`` category spacings either side."""
    if caps and "half" not in result:
        raise ValueError("caps need whiskers: pick SD, SEM or 95 % CI first")
    vals = [result["values"][i] for i in result["order"]]
    halves = [result["half"][i] for i in result["order"]] if "half" in result else None
    ends = [e for v, h in zip(vals, halves or [None] * len(vals), strict=True)
            for e in ((v - h, v + h) if h is not None else (v,))]
    lo, hi = min(0.0, *ends), max(0.0, *ends)
    pad = _PAD * (hi - lo) if hi > lo else 1.0
    n = len(vals)
    if horizontal:
        pos = [float(n - 1 - k) for k in range(n)]
        geo: dict[str, Any] = {
            "x_domain": [lo - pad, hi + pad],
            "y_domain": [-0.5, n - 0.5],
            "positions": pos,
            "stems": [[[0.0, p], [v, p]] for p, v in zip(pos, vals, strict=True)],
            "dots": [[v, p] for p, v in zip(pos, vals, strict=True)],
        }
    else:
        pos = [float(k) for k in range(n)]
        geo = {
            "x_domain": [-0.5, n - 0.5],
            "y_domain": [lo - pad, hi + pad],
            "stems": [[[float(k), 0.0], [float(k), v]] for k, v in enumerate(vals)],
            "dots": [[float(k), v] for k, v in enumerate(vals)],
        }
    if halves is not None:
        geo["whiskers"] = [
            [[v - h, p], [v + h, p]] if horizontal else [[p, v - h], [p, v + h]]
            for p, v, h in zip(pos, vals, halves, strict=True) if h is not None
        ]
        text = _WHISKER_LEGEND[result["whisker"]]
        if caps:
            geo["caps"] = [
                [[v + s * h, p - CAP_HALF], [v + s * h, p + CAP_HALF]] if horizontal
                else [[p - CAP_HALF, v + s * h], [p + CAP_HALF, v + s * h]]
                for p, v, h in zip(pos, vals, halves, strict=True) if h is not None
                for s in (-1, 1)
            ]
        geo["legend"] = text + ("; none for one value" if None in halves else "")
    return geo
