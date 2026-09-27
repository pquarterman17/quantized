"""Per-series DECADE offsets for a log-y comparison plot (audit P2.3, box 3).

Pure calc layer. On a logarithmic y axis an additive stagger is meaningless,
so profiles that overlap (SIMS species, or one species across samples) are
separated MULTIPLICATIVELY: series ``i`` is drawn at ``y * 10**k_i``, which on
a log axis is a rigid shift of ``k_i`` decades. ``k`` is a whole number of
decades, so the legend can state it exactly -- every offset series' name
gains the suffix ``" ×10^k"`` (``log_offset_suffix``) BEFORE its unit is
appended, which is the name the canvas shows (``frontend/src/lib/logOffset.ts``
is the client half and must agree with this rule character for character).

The data are never changed: ``dataset`` on the wire keeps the true values;
this is render metadata, like ``apply_waterfall_offsets``' additive stagger.
A missing, non-integer, non-finite or out-of-range (``|k| > MAX_DECADES``)
entry means no offset for that series -- an export degrades, never 500s, on a
malformed hint.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any

import numpy as np

from .plotting import PlotSeries

__all__ = [
    "MAX_DECADES",
    "apply_log_offsets",
    "log_offset_decades",
    "log_offset_suffix",
    "scale_error_spans",
]

MAX_DECADES = 30


def log_offset_decades(value: object) -> int:
    """The usable offset in decades for one wire entry (0 = none)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    v = float(value)
    if not math.isfinite(v) or v != round(v) or abs(v) > MAX_DECADES:
        return 0
    return int(v)


def log_offset_suffix(decades: int) -> str:
    """The legend suffix for an offset series (``""`` for no offset)."""
    return f" ×10^{decades}" if decades else ""


def apply_log_offsets(
    series: Sequence[PlotSeries], decades: Sequence[object] | None
) -> list[PlotSeries]:
    """Scale each series by ``10**k`` and suffix its label; ``decades`` is
    aligned to the plotted series (the request's ``y_keys``)."""
    if not decades:
        return list(series)
    out: list[PlotSeries] = []
    for i, s in enumerate(series):
        k = log_offset_decades(decades[i]) if i < len(decades) else 0
        if not k:
            out.append(s)
            continue
        values = np.asarray(np.asarray(s.values, dtype=float) * (10.0**k), dtype=float)
        out.append(replace(s, label=s.label + log_offset_suffix(k), values=values))
    return out


def _scale_mags(raw: Any, f: float) -> Any:
    """Scale a plain list of magnitudes by ``f``; anything else (missing,
    malformed) passes through untouched -- ``figure_errorbars.apply_error_bars``
    is the one place these are actually interpreted, and it already degrades
    a malformed entry rather than raising."""
    if not isinstance(raw, (list, tuple)):
        return raw
    return [v * f if isinstance(v, (int, float)) and math.isfinite(v) else v for v in raw]


def scale_error_spans(
    spans: Sequence[Mapping[str, Any] | None] | None,
    decades: Sequence[object] | None,
) -> Sequence[Mapping[str, Any] | None] | None:
    """Scale each series' Y error span by ``10**k`` alongside ``apply_log_
    offsets`` -- the SAME ``decades`` list, aligned to ``y_keys``, exactly
    like the values they bracket (MAIN_PLAN #36 review finding 3). X spans
    are left alone: a decade offset shifts a series vertically, never
    sideways, so an uncertainty in x means the same thing either way."""
    if not spans or not decades:
        return spans
    out: list[Mapping[str, Any] | None] = []
    changed = False
    for i, span in enumerate(spans):
        k = log_offset_decades(decades[i]) if i < len(decades) else 0
        if not k or not isinstance(span, Mapping) or not isinstance(span.get("y"), Mapping):
            out.append(span)
            continue
        changed = True
        f = 10.0**k
        y = span["y"]
        scaled_y = dict(y)
        if "plus" in y:
            scaled_y["plus"] = _scale_mags(y.get("plus"), f)
        if "minus" in y:
            scaled_y["minus"] = _scale_mags(y.get("minus"), f)
        out.append({**span, "y": scaled_y})
    return out if changed else spans
