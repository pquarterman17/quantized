"""Waterfall X offset -- the export half of a waterfall's per-series x step.

Origin's waterfall slides series ``i`` by ``i * dx`` along x as well as up by
``i * dy``. The vertical half is ``calc.plotting.apply_waterfall_offsets``; this
is the horizontal one. A figure's series share ONE x array, so a per-series x
shift is laid out the way the canvas lays it out
(``frontend/src/lib/waterfallX.ts``): one x BLOCK per series holding
``x + offset_i``, each series' values inside its own block and NaN in every
other (a NaN breaks a matplotlib line, exactly as a null breaks a uPlot one).
The renderer then draws every series at its own shifted x with no change of
its own. Error spans and a colour-by column are row-aligned to the series, so
they are placed in the same block.

The offsets arrive RESOLVED in x data units, aligned to the plotted series
(``FigureRequest.waterfall_x_offsets``), for the same reason the y offsets do:
the fraction the user sets is a share of the canvas' x-range. A missing or
non-finite entry is 0; all-zero (or absent) is a pass-through, so a figure
with no X offset renders byte-identically to before the field existed.
Pure: numpy arrays and plain dicts in, new ones out -- nothing is mutated.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["apply_waterfall_x_offsets"]

Styles = list[dict[str, Any] | None] | None
Spans = Sequence[Mapping[str, Any] | None] | None


def _resolved(offsets: Sequence[float] | None, n: int) -> list[float] | None:
    """One finite offset per series (bad/missing -> 0), or None when all are 0."""
    if not offsets:
        return None
    out: list[float] = []
    for i in range(n):
        v = offsets[i] if i < len(offsets) else 0.0
        f = float(v) if isinstance(v, (int, float)) else 0.0
        out.append(f if math.isfinite(f) else 0.0)
    return out if any(o != 0.0 for o in out) else None


def _place(values: Sequence[Any], block: int, rows: int, blocks: int, fill: Any) -> list[Any]:
    """``values`` (row-aligned) inside ``block`` of a ``blocks * rows`` column."""
    out: list[Any] = [fill] * (rows * blocks)
    for r, v in enumerate(list(values)[:rows]):
        out[block * rows + r] = v
    return out


def _place_span(span: Mapping[str, Any] | None, block: int, rows: int, blocks: int) -> Any:
    if not isinstance(span, Mapping):
        return span
    out: dict[str, Any] = dict(span)
    for axis in ("x", "y"):
        half = span.get(axis)
        if isinstance(half, Mapping):
            out[axis] = {
                k: _place(v, block, rows, blocks, None) if isinstance(v, (list, tuple)) else v
                for k, v in half.items()
            }
    return out


def apply_waterfall_x_offsets(
    x: NDArray[np.float64],
    series: Sequence[tuple[str, Any]],
    styles: Styles,
    spans: Spans,
    offsets: Sequence[float] | None,
) -> tuple[NDArray[np.float64], list[tuple[str, Any]], Styles, Spans]:
    """Shift each series right by its own offset (see the module doc).

    Returns ``(x, series, styles, spans)``; the inputs come back unchanged (the
    very same ``x`` object) when no series is offset."""
    shifts = _resolved(offsets, len(series))
    if shifts is None:
        return x, list(series), styles, spans
    xv = np.asarray(x, dtype=float)
    rows, blocks = len(xv), len(series)
    out_x = np.asarray(np.concatenate([xv + s for s in shifts]), dtype=float)
    out_series: list[tuple[str, Any]] = []
    for i, (label, v) in enumerate(series):
        placed = _place(np.asarray(v, dtype=float).tolist(), i, rows, blocks, math.nan)
        out_series.append((label, np.asarray(placed, dtype=float)))
    out_styles: Styles = None
    if styles is not None:
        out_styles = []
        for i, spec in enumerate(styles):
            cb = spec.get("color_by") if spec else None
            if spec and isinstance(cb, (list, tuple)) and i < blocks:
                out_styles.append({**spec, "color_by": _place(cb, i, rows, blocks, math.nan)})
            else:
                out_styles.append(spec)
    out_spans: Spans = None
    if spans is not None:
        out_spans = [
            _place_span(s, i, rows, blocks) if i < blocks else s for i, s in enumerate(spans)
        ]
    return out_x, out_series, out_styles, out_spans
