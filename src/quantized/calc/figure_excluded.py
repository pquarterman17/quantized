"""Excluded rows on an export: blank them, or draw them as grey companions.

FIGURE_AUTHORING_WORKFLOW_PLAN F4.2c (a). A plot window draws a row that is
excluded, or dropped by the Data Filter, in one of two ways (the app-wide
"Excluded rows" preference): hidden, or as a muted, line-free "(excluded)"
companion of its series (``lib/plotdata.ts``'s ``maskExcludedPayload``). An
export asks which of the two to draw.

The flat request carries the greyed rows client-side as extra channels
(``lib/excludedRowsExport.ts``). This module is the server-side form, for a
request the backend splits itself (the encoded Color / Symbol / label-source
split). Its levels come from EVERY row, as the window's do, so the request sends
the full rows plus the mask. The dropped rows are then blanked in every series,
and in grey mode each series gets one companion that draws only them, appended
after all the series, in series order, as the window appends them.

:data:`EXCLUDED_GHOST_STYLE` mirrors the frontend's ``EXCLUDED_GHOST_STYLE``
(``lib/excludedRowsExport.ts``): a grey ink for paper, so a literal on both sides.
Pure: arrays in, plain values out.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["EXCLUDED_GHOST_STYLE", "EXCLUDED_SUFFIX", "excluded_mask", "with_excluded_rows"]

#: A companion's style: grey markers, no line (the frontend's constant).
EXCLUDED_GHOST_STYLE: Mapping[str, Any] = {
    "color": "#9a9a9a",
    "line": "none",
    "width": 0,
    "marker": True,
    "marker_size": 3,
}
#: Appended to a series' name to name its companion (the window's own label).
EXCLUDED_SUFFIX = " (excluded)"


def excluded_mask(n_rows: int, rows: Sequence[int] | None) -> NDArray[np.bool_] | None:
    """A boolean row mask for ``rows``, or ``None`` when none are excluded.
    Raises ``ValueError`` for a row outside ``[0, n_rows)``: a negative index
    must never wrap around to blank another row."""
    if not rows:
        return None
    idx = np.asarray(rows, dtype=np.intp)
    if idx.min() < 0 or idx.max() >= n_rows:
        raise ValueError(f"excluded_rows must index the dataset's {n_rows} rows")
    mask = np.zeros(n_rows, dtype=bool)
    mask[idx] = True
    return mask


def with_excluded_rows(
    series: Sequence[tuple[str, Any]],
    styles: Sequence[Mapping[str, Any] | None],
    error_spans: Sequence[Mapping[str, Any] | None] | None,
    mask: NDArray[np.bool_],
    *,
    grey: bool,
) -> tuple[
    list[tuple[str, Any]],
    list[dict[str, Any] | None],
    list[Mapping[str, Any] | None] | None,
]:
    """Blank the ``mask`` rows in every series. With ``grey``, also append one
    companion per series that draws only those rows, named
    ``"<name> (excluded)"``, styled :data:`EXCLUDED_GHOST_STYLE`, and without
    an error span. The styles and spans are extended to stay 1:1 with the
    series."""
    kept: list[tuple[str, Any]] = []
    ghosts: list[tuple[str, Any]] = []
    for name, values in series:
        v = np.asarray(values, dtype=float)
        kept.append((name, np.where(mask, np.nan, v)))
        ghosts.append((f"{name}{EXCLUDED_SUFFIX}", np.where(mask, v, np.nan)))
    out_styles: list[dict[str, Any] | None] = [dict(s) if s else None for s in styles]
    out_spans = None if error_spans is None else list(error_spans)
    if not grey:
        return kept, out_styles, out_spans
    n = len(series)
    ghost_styles: list[dict[str, Any] | None] = [dict(EXCLUDED_GHOST_STYLE) for _ in range(n)]
    spans = None if out_spans is None else [*out_spans, *([None] * n)]
    return [*kept, *ghosts], [*out_styles, *ghost_styles], spans
