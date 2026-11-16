"""Analysis overlays never drive the export's autoscale -- the export half of
the canvas rule in ``frontend/src/lib/overlayAutoscale.ts`` (UX audit 7 #8).

A fit curve, its band edges, an estimated or fitted baseline and peak markers
ride the export request as ordinary series, marked one flag per ``y_keys``
entry by ``FigureRequest.analysis_overlays``. They are drawn against the data;
they are not the data. The canvas leaves them out of its scale's auto range
whenever a data series shares the axis (an overlay alone on its axis still
ranges it), so a fitted linear background diving through zero no longer drags
a log axis down to 1e-3. The export follows:

* ``routes/export_figures`` marks each flagged series' RESOLVED style with
  :data:`OVERLAY_STYLE_KEY` (:func:`mark_overlay_styles`) -- the per-series
  style list already reaches every renderer, so no signature changes;
* the series drawer tags the drawn artist (:func:`tag_overlay`;
  ``figure_marks.draw_marked_series``, ``figure_break``'s panels);
* ``figure_autoscale._values`` -- the scan behind ``shared_autoscale`` AND
  the Y-break sizing (``axis_breaks._series_values``) -- leaves tagged
  artists out when an untagged series artist is on the same axis
  (:func:`is_overlay`).

Pure layer (matplotlib artists only, duck-typed).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

__all__ = ["OVERLAY_STYLE_KEY", "is_overlay", "mark_overlay_styles", "tag_overlay"]

#: The resolved-style key that marks an analysis overlay series (internal:
#: set by the route from ``analysis_overlays``, never part of the wire style).
OVERLAY_STYLE_KEY = "analysis_overlay"
_ATTR = "_qz_analysis_overlay"


def mark_overlay_styles(
    styles: list[dict[str, Any] | None] | None, flags: Sequence[bool] | None
) -> list[dict[str, Any] | None] | None:
    """``styles`` with every series ``flags`` marks carrying
    :data:`OVERLAY_STYLE_KEY`; ``styles`` itself when nothing is flagged."""
    if not flags or not any(flags):
        return styles
    n = max(len(flags), len(styles or []))
    out: list[dict[str, Any] | None] = []
    for k in range(n):
        s = styles[k] if styles is not None and k < len(styles) else None
        out.append({**(s or {}), OVERLAY_STYLE_KEY: True} if k < len(flags) and flags[k] else s)
    return out


def tag_overlay(artist: Any, spec: Mapping[str, Any] | None) -> None:
    """Tag a drawn series artist as an analysis overlay when its style says so."""
    if spec and spec.get(OVERLAY_STYLE_KEY):
        setattr(artist, _ATTR, True)


def is_overlay(artist: Any) -> bool:
    """Was ``artist`` drawn for an analysis overlay?"""
    return bool(getattr(artist, _ATTR, False))
