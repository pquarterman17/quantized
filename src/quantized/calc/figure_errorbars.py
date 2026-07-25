"""Error bars for the publication renderer (MAIN_PLAN #36).

The interactive canvas gained asymmetric and X error bars; without this the
exported figure would quietly omit them, so a PDF would understate the
uncertainty the screen showed. "Interactive and export agree" is the sub-item,
and a renderer that silently drops error bars is the worst way to fail it — the
figure still looks finished.

The payload mirrors the frontend's ``ErrorSpan``: per plotted series, an
optional x and y span, each with independent ``plus``/``minus`` magnitudes
(equal for a symmetric binding).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["apply_error_bars"]


def _mags(raw: Any, n: int) -> NDArray[np.float64] | None:
    """One magnitude array, NaN where absent. ``None`` when nothing usable."""
    if not isinstance(raw, (list, tuple)) or not raw:
        return None
    out = np.full(n, np.nan, dtype=float)
    for i, v in enumerate(raw[:n]):
        if isinstance(v, (int, float)) and np.isfinite(v):
            # abs(): a sign on an uncertainty column is a convention artefact,
            # not a direction — the SIDE is carried by the span, not the value.
            out[i] = abs(float(v))
    return out if np.any(np.isfinite(out)) else None


def _pair(span: Mapping[str, Any], n: int) -> NDArray[np.float64] | None:
    """matplotlib wants a (2, N) [lower, upper] array for asymmetric bars."""
    plus = _mags(span.get("plus"), n)
    minus = _mags(span.get("minus"), n)
    if plus is None and minus is None:
        return None
    if plus is None:
        plus = np.full(n, np.nan)
    if minus is None:
        minus = np.full(n, np.nan)
    # NaN would propagate into the drawn cap; 0 means "no bar on this side",
    # which is the honest rendering of a missing half.
    return np.vstack([np.nan_to_num(minus), np.nan_to_num(plus)])


def apply_error_bars(
    ax: Any,
    xv: NDArray[np.float64],
    series: Sequence[tuple[str, Any]],
    spans: Sequence[Mapping[str, Any] | None] | None,
    artists: Sequence[Any],
) -> None:
    """Overlay error bars on already-drawn series.

    Drawn as a separate ``errorbar`` call with ``fmt="none"`` rather than by
    re-plotting each series through ``ax.errorbar``: the lines, fills and
    colour-mapped scatter are already on the axes with their own styling, and
    re-drawing them would change how they look in the export only. Bars inherit
    each series' own colour so a multi-series plot stays readable.
    """
    if not spans:
        return
    n = len(xv)
    for i, (_label, y) in enumerate(series):
        span = spans[i] if i < len(spans) else None
        if not isinstance(span, Mapping):
            continue
        yv = np.asarray(y, dtype=float)
        yerr = _pair(span["y"], n) if isinstance(span.get("y"), Mapping) else None
        xerr = _pair(span["x"], n) if isinstance(span.get("x"), Mapping) else None
        if yerr is None and xerr is None:
            continue
        artist = artists[i] if i < len(artists) else None
        color = None
        try:
            color = artist.get_color() if artist is not None else None
        except AttributeError:
            color = None  # a colour-mapped scatter has no single colour
        ax.errorbar(
            xv,
            yv,
            yerr=yerr,
            xerr=xerr,
            fmt="none",
            ecolor=color,
            elinewidth=1,
            capsize=2,
            zorder=1,  # behind the series line, so data stays legible
        )
