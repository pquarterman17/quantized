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

from quantized.heavy_import import heavy_imports

__all__ = ["apply_error_bars", "band_quads", "error_bar_style"]

# Gap audit 4 G8: the band's translucency -- the canvas' FILL_ALPHA_PCT (25 %,
# `lib/uplotFill.ts`), the same as a fill under a curve (`calc.figure._FILL_ALPHA`).
_BAND_ALPHA = 0.25

# The defaults every bound bar used before per-series styling (gap audit 2
# #6), and still uses when a series sets none: the canvas' 1 px bar and
# ERROR_CAP_HALF_PX cap (`lib/uplotErrorRange.ts`) are drawn to match them.
_CAPSIZE = 2.0
_ELINEWIDTH = 1.0


def _points(v: Any, lo: float) -> float | None:
    """A finite size in points within [lo, 100], else ``None`` (the default)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if np.isfinite(f) and lo <= f <= 100 else None


def error_bar_style(spec: Mapping[str, Any] | None) -> tuple[float, float, str | None]:
    """``(capsize, elinewidth, colour)`` for one series' bars from its style
    spec's ``error_cap`` / ``error_width`` / ``error_color`` (gap audit 2 #6,
    the wire form of the canvas' ``SeriesStyle.errorBar``). A bad or absent
    value degrades to the default -- an export never 500s on a style hint.
    Colour ``None`` = the series' own drawn colour."""
    if not isinstance(spec, Mapping):
        return _CAPSIZE, _ELINEWIDTH, None
    cap = _points(spec.get("error_cap"), 0.0)
    width = _points(spec.get("error_width"), 0.01)
    color = spec.get("error_color")
    return (
        _CAPSIZE if cap is None else cap,
        _ELINEWIDTH if width is None else width,
        color if isinstance(color, str) and color else None,
    )


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


def band_quads(
    xv: NDArray[np.float64], yv: NDArray[np.float64], yerr: NDArray[np.float64]
) -> list[tuple[float, float, float, float, float, float]]:
    """The Y error band of one series (gap audit 4 G8) as one quad per drawn
    segment, ``(xl, hi_l, xr, hi_r, lo_r, lo_l)`` with the lower-X end first --
    the canvas' ``uplotErrorBand.bandQuads``. Rows i and i+1 form a segment
    when both have finite x and y: ROW ORDER, never sorted, so a descending
    sweep or a hysteresis loop is shaded along the curve as acquired. ``yerr``
    is the (2, N) ``[minus, plus]`` array from :func:`_pair` (a missing side
    is 0)."""
    out: list[tuple[float, float, float, float, float, float]] = []
    ok = np.isfinite(xv) & np.isfinite(yv)
    for i in range(len(yv) - 1):
        a, b = i, i + 1
        if not (ok[a] and ok[b]):
            continue
        if xv[b] < xv[a]:
            a, b = b, a
        out.append((
            float(xv[a]), float(yv[a] + yerr[1][a]), float(xv[b]), float(yv[b] + yerr[1][b]),
            float(yv[b] - yerr[0][b]), float(yv[a] - yerr[0][a]),
        ))
    return out


def _draw_band(ax: Any, quads: Sequence[tuple[float, ...]], color: Any) -> None:
    """All quads in ONE path, each wound the same way, filled once: where the
    branches of a loop overlap the shade is their union (nonzero rule), not a
    doubled alpha -- as on the canvas. Behind the line, like the bars."""
    if not quads:
        return
    with heavy_imports("matplotlib.patches", "matplotlib.path"):
        from matplotlib.patches import PathPatch
        from matplotlib.path import Path
    verts: list[tuple[float, float]] = []
    quad_codes = [int(Path.MOVETO)] + [int(Path.LINETO)] * 3 + [int(Path.CLOSEPOLY)]
    for xl, hl, xr, hr, lr, ll in quads:
        verts += [(xl, hl), (xr, hr), (xr, lr), (xl, ll), (xl, hl)]
    codes = quad_codes * len(quads)
    ax.add_patch(PathPatch(
        Path(verts, codes), facecolor=color, edgecolor="none", linewidth=0,
        alpha=_BAND_ALPHA, zorder=1,
    ))


def apply_error_bars(
    ax: Any,
    xv: NDArray[np.float64],
    series: Sequence[tuple[str, Any]],
    spans: Sequence[Mapping[str, Any] | None] | None,
    artists: Sequence[Any],
    styles: Sequence[Mapping[str, Any] | None] | None = None,
) -> None:
    """Overlay error bars on already-drawn series.

    Drawn as a separate ``errorbar`` call with ``fmt="none"`` rather than by
    re-plotting each series through ``ax.errorbar``: the lines, fills and
    colour-mapped scatter are already on the axes with their own styling, and
    re-drawing them would change how they look in the export only. Bars inherit
    each series' own colour so a multi-series plot stays readable, unless that
    series' style (``styles[i]``, :func:`error_bar_style`) sets cap size, line
    width or colour.
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
        style = styles[i] if styles and i < len(styles) else None
        capsize, elinewidth, color = error_bar_style(style)
        if color is None:
            try:
                color = artist.get_color() if artist is not None else None
            except AttributeError:
                color = None  # a colour-mapped scatter has no single colour
        if yerr is not None and isinstance(style, Mapping) and style.get("error_band") is True:
            _draw_band(ax, band_quads(np.asarray(xv, dtype=float), yv, yerr), color or "0.5")
            yerr = None  # gap audit 4 G8: shaded, not barred; X bars stay bars
            if xerr is None:
                continue
        container = ax.errorbar(
            xv,
            yv,
            yerr=yerr,
            xerr=xerr,
            fmt="none",
            ecolor=color,
            elinewidth=elinewidth,
            capsize=capsize,
            zorder=1,  # behind the series line, so data stays legible
        )
        # matplotlib returns an ErrorbarContainer -- a tuple subclass of
        # (data_line, caplines, barlinecols). A minimal axes stand-in (the
        # unit tests' recording fake) may return None; treat anything that is
        # not a 3-tuple as "no caps to restyle" rather than unpacking blindly.
        caplines = container[1] if isinstance(container, tuple) and len(container) > 1 else ()
        if color is not None:
            # `ecolor=` above colours the bar lines and each cap's EDGE, but
            # matplotlib's cap markers ('|'/'_') keep their default FACE
            # colour (rcParams' C0) regardless -- passing markerfacecolor=
            # to errorbar() itself is silently dropped for these marker
            # styles, so the face has to be set on the returned cap Line2Ds
            # directly. Otherwise a "print-safe" greyscale export still
            # emits a chromatic `fill: #1f77b4` for every cap in vector
            # output (PDF/SVG) -- invisible in a raster PNG only because the
            # cap's degenerate fill path paints zero visible pixels there.
            # This also corrects the ordinary COLOURED case: before this fix,
            # every series' caps were filled with rcParams' C0 regardless of
            # that series' own colour (e.g. series 2's caps rendered blue,
            # not orange) in any coloured vector export -- a second, latent
            # fix beyond the greyscale defect this was written for.
            for cap in caplines:
                cap.set_markerfacecolor(color)
                cap.set_markeredgecolor(color)
