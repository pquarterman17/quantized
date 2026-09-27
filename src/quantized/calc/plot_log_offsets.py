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
from collections.abc import Sequence
from dataclasses import replace

import numpy as np

from .plotting import PlotSeries

__all__ = ["MAX_DECADES", "apply_log_offsets", "log_offset_decades", "log_offset_suffix"]

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
