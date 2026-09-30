"""Graph Builder Color-by / Symbol-by / legend-label source -- the export half.

PRIMARY_SOFTWARE_AUDIT_PLAN P1.4 ("Any suitable factor can drive Group, Facet,
Legend, Color, Symbol, or X" and "Sample ID, field, or temperature can
independently label the legend"). Faithful port of the frontend's
``lib/plotEncoding.ts`` ``buildEncodedXY`` + ``encodedStyles`` -- the SAME
relationship :func:`quantized.calc.plotting.build_grouped_series` has with
``lib/plotspec.ts`` ``buildXY``, and for the same reason: the Graph Builder
preview draws what that module computes, and the exported figure must draw the
same series with the same colours, glyphs and legend text. Kept out of
``calc/plotting.py`` for that module's 500-line ceiling; pure (arrays in, plain
values out), no fastapi/pydantic.

THE SPLIT. The distinct factor columns among ``group_col``, ``color_col`` and
``symbol_col`` (in that order, a repeated column counted once) partition the
rows: one series per ``(y channel, level combination)`` PRESENT in the data,
channel-major, combinations in nested display order (outer factor first, each
factor's levels through :func:`quantized.calc.plotting._ordered_levels`, so a
user's ``level_order`` holds here too). A row with a non-finite value in ANY
factor belongs to no series -- the group split's own rule. With no factor at
all (only a legend-label source) there is one series per channel over every
row.

ENCODING. A series' colour is ``palette[k % len(palette)]`` where ``k`` is its
colour-factor LEVEL index when ``color_col`` is set, else its own display
position -- the screen's ``seriesColor`` rule. Its glyph is
``markers[k % len(markers)]`` with ``k`` its symbol-factor level index. The
client sends ``palette``/``markers`` already resolved (``SERIES_VARS`` through
the live theme, and ``AUTO_MARKER_CYCLE``): the backend cannot read CSS tokens,
and the cycles stay defined once, on the screen side.

LEGEND TEXT. With ``label_col``, a series' legend is that column's level(s) on
the series' rows (every row of its combination, whatever its y), formatted like
a group level plus the column's unit, joined with ", " -- or ``"first … last
(n values)"`` past three, so a ramp never produces a paragraph. It replaces the
whole default name (a BUG-014-style verbatim rename, no unit appended); with
more than one y channel it is prefixed ``"{y_label} (…)"`` so channels stay
distinguishable. No finite value on those rows keeps the default name.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_colorscatter import GRADIENT_STOPS
from quantized.calc.figure_greyscale import GREY_SLOT_KEY
from quantized.calc.figure_group_styles import expand_grouped_series_styles
from quantized.calc.plotting import (
    PlotData,
    PlotSeries,
    _default_x_label,
    _format_level,
    _ordered_levels,
    _resolve,
)
from quantized.datastruct import DataStruct, is_categorical, level_of

__all__ = [
    "LABEL_LIST_MAX",
    "EncodedPlot",
    "build_encoded_series",
    "encoded_series_styles",
    "gradient_spec",
    "legend_source_text",
]

#: Distinct label values listed in full before the "first … last (n values)" form.
LABEL_LIST_MAX = 3


@dataclass(frozen=True, slots=True)
class EncodedPlot:
    """``plot`` plus, per series (1:1 with ``plot.series``): the label-source
    legend (``None`` = keep the default name) and the colour/symbol factor
    LEVEL indices (``None`` when that factor is not set), and the rows of its
    level combination (``calc.plotting_encoded_facets`` slices them per panel)."""

    plot: PlotData
    legends: tuple[str | None, ...]
    color_levels: tuple[int | None, ...]
    symbol_levels: tuple[int | None, ...]
    rows: tuple[NDArray[np.intp], ...] = ()


def _level_text(ds: DataStruct, channel: int, value: float) -> str:
    """A level's display text -- ``lib/categorical.ts``'s ``groupLevelLabel``."""
    text = level_of(ds, channel, value) if is_categorical(ds, channel) else None
    return text if text is not None else _format_level(value)


def legend_source_text(ds: DataStruct, label_col: int, rows: NDArray[np.intp]) -> str | None:
    """The legend text ``label_col`` gives the series built from ``rows``
    (see the module doc), or ``None`` when those rows carry no finite value."""
    vals = ds.values[rows, label_col]
    present = _ordered_levels(ds, label_col, vals[np.isfinite(vals)])
    if present.size == 0:
        return None
    unit = ds.units[label_col]
    texts = [_level_text(ds, label_col, float(v)) for v in present]
    if unit:
        texts = [f"{t} {unit}" for t in texts]
    if len(texts) <= LABEL_LIST_MAX:
        return ", ".join(texts)
    return f"{texts[0]} … {texts[-1]} ({len(texts)} values)"


def _check(ds: DataStruct, channel: int | str, name: str) -> int:
    """Resolve ``channel`` and refuse anything outside ``[0, n_channels)`` --
    a bare ``_resolve`` would let numpy's negative indexing silently plot
    another column."""
    idx = _resolve(ds, channel)
    if not (0 <= idx < ds.n_channels):
        raise ValueError(f"{name} {channel!r} is out of range")
    return idx


def _opt(ds: DataStruct, channel: int | str | None, name: str) -> int | None:
    return None if channel is None else _check(ds, channel, name)


def _level_index(codes: NDArray[np.float64], levels: NDArray[np.float64]) -> NDArray[np.intp]:
    """Each row's DISPLAY index into ``levels`` (-1 when the value is none of
    them -- a NaN always), in one sorted pass rather than a scan per level."""
    out = np.full(codes.shape[0], -1, dtype=np.intp)
    if levels.size == 0:
        return out
    order = np.argsort(levels, kind="stable")  # levels[order] is ascending
    ascending = levels[order]
    pos = np.searchsorted(ascending, codes)
    clipped = np.minimum(pos, levels.size - 1)
    hit = (pos < levels.size) & (ascending[clipped] == codes)
    out[hit] = order[clipped[hit]]
    return out


def build_encoded_series(
    ds: DataStruct,
    x_key: int | str | None,
    y_keys: Sequence[int | str],
    *,
    group_col: int | str | None = None,
    color_col: int | str | None = None,
    symbol_col: int | str | None = None,
    label_col: int | str | None = None,
    y_legends: Sequence[str | None] | None = None,
) -> EncodedPlot:
    """Split ``y_keys`` by the encoding factors (see the module doc).

    ``y_legends`` is BUG-014's per-``y_keys`` rename, replacing the channel
    label in both the default name and the multi-channel legend prefix, exactly
    as :func:`quantized.calc.plotting.build_grouped_series` uses it. Raises
    ``ValueError`` for a channel that doesn't resolve -- the route's usual 422.
    """
    if x_key is None:
        x = ds.time
        x_label = _default_x_label(ds)
        x_unit = str(ds.metadata.get("x_column_unit", ""))
    else:
        xi = _check(ds, x_key, "x_key")
        x, x_label, x_unit = ds.values[:, xi], ds.labels[xi], ds.units[xi]

    color = _opt(ds, color_col, "color_col")
    symbol = _opt(ds, symbol_col, "symbol_col")
    label = _opt(ds, label_col, "label_col")
    factors: list[int] = []
    for c in (_opt(ds, group_col, "group_col"), color, symbol):
        if c is not None and c not in factors:
            factors.append(c)
    columns = [ds.values[:, f] for f in factors]
    levels = [
        _ordered_levels(ds, f, c[np.isfinite(c)]) for f, c in zip(factors, columns, strict=True)
    ]

    # Each row's combination as level indices (outer factor first); a row whose
    # value in any factor is non-finite -- so absent from that factor's levels
    # -- joins no combination.
    n_rows = ds.values.shape[0]
    idx = np.zeros((n_rows, len(factors)), dtype=np.intp)
    for j, (codes, lv) in enumerate(zip(columns, levels, strict=True)):
        idx[:, j] = _level_index(codes, lv)
    rows = np.flatnonzero(np.all(idx >= 0, axis=1))
    combo_rows: dict[tuple[int, ...], NDArray[np.intp]] = {}
    if factors and rows.size:
        # `np.unique(axis=0)` sorts lexicographically == nested display order;
        # one stable sort by combination keeps each one's rows ascending.
        keys, inverse = np.unique(idx[rows], axis=0, return_inverse=True)
        inverse = inverse.reshape(-1)
        bounds = np.cumsum(np.bincount(inverse, minlength=len(keys)))[:-1]
        grouped = np.split(rows[np.argsort(inverse, kind="stable")], bounds)
        combo_rows = {tuple(int(v) for v in k): g for k, g in zip(keys, grouped, strict=True)}
    elif not factors and n_rows:
        combo_rows = {(): np.arange(n_rows, dtype=np.intp)}
    combos = list(combo_rows)

    color_at = factors.index(color) if color is not None else -1
    symbol_at = factors.index(symbol) if symbol is not None else -1
    texts = {
        k: (legend_source_text(ds, label, combo_rows[k]) if label is not None else None)
        for k in combos
    }

    series: list[PlotSeries] = []
    legends: list[str | None] = []
    color_levels: list[int | None] = []
    symbol_levels: list[int | None] = []
    series_rows: list[NDArray[np.intp]] = []
    for c, yk in enumerate(y_keys):
        yi = _check(ds, yk, "y_keys entry")
        rename = y_legends[c] if y_legends is not None and c < len(y_legends) else None
        y_label = ds.labels[yi] if rename is None else rename
        y_vals = ds.values[:, yi]
        for k in combos:
            mask = np.zeros(y_vals.shape[0], dtype=bool)
            mask[combo_rows[k]] = True
            mask &= np.isfinite(y_vals)
            parts = [
                f"{ds.labels[f]}={_level_text(ds, f, float(levels[j][k[j]]))}"
                for j, f in enumerate(factors)
            ]
            series.append(
                PlotSeries(
                    label=f"{y_label} ({', '.join(parts)})" if parts else y_label,
                    unit=ds.units[yi],
                    values=np.asarray(np.where(mask, y_vals, np.nan), dtype=float),
                    axis=0,
                )
            )
            text = texts[k]
            legends.append(
                None if text is None else (text if len(y_keys) == 1 else f"{y_label} ({text})")
            )
            color_levels.append(k[color_at] if color_at >= 0 else None)
            symbol_levels.append(k[symbol_at] if symbol_at >= 0 else None)
            series_rows.append(combo_rows[k])

    plot = PlotData(
        x=x, x_label=x_label, x_unit=x_unit, series=tuple(series), x_log=False, y_log=False
    )
    return EncodedPlot(
        plot, tuple(legends), tuple(color_levels), tuple(symbol_levels), tuple(series_rows)
    )


def encoded_series_styles(
    encoded: EncodedPlot,
    channel_styles: Sequence[Mapping[str, Any] | None] | None,
    n_channels: int,
    *,
    palette: Sequence[str] | None,
    markers: Sequence[str] | None,
    color_by_level: bool,
    gradient: Mapping[str, Any] | None = None,
) -> list[dict[str, Any] | None]:
    """Per-series styles for an encoded figure: the ``y_keys``-aligned
    ``channel_styles`` expanded onto each channel's series (BUG-016's
    :func:`expand_grouped_series_styles`, same channel-major nesting), then the
    encoding laid over them -- a palette colour (overriding any channel colour
    when ``color_by_level``, else filling only a missing one, as the screen's
    ``seriesColor`` does) and, for a symbol factor, ``marker`` + its glyph.
    With ``color_by_level`` each series also names its colour level as its
    greyscale slot (:data:`quantized.calc.figure_greyscale.GREY_SLOT_KEY`), so
    print-safe mode greys a level alike on every Y channel.

    ``gradient`` (:func:`gradient_spec`, P1.4 residual 4) makes every series a
    colour-mapped scatter over the same per-row values, stops and range --
    ``calc.figure_colorscatter``'s gradient branch, the screen's colour rule --
    with one colourbar (on the first series); a symbol factor's glyph still
    applies."""
    n = len(encoded.plot.series)
    expanded = expand_grouped_series_styles(channel_styles, n_channels, n) or [None] * n
    out: list[dict[str, Any] | None] = []
    for i in range(n):
        st: dict[str, Any] = dict(expanded[i] or {})
        level = encoded.color_levels[i]
        if color_by_level and level is not None:
            st[GREY_SLOT_KEY] = level
        if palette:
            if color_by_level and level is not None:
                st["color"] = palette[level % len(palette)]
            elif not st.get("color"):
                st["color"] = palette[i % len(palette)]
        glyph = encoded.symbol_levels[i]
        if markers and glyph is not None:
            st["marker"] = True
            st["marker_shape"] = markers[glyph % len(markers)]
        if gradient is not None:
            st.update(gradient)
            st["colorbar"] = i == 0
        out.append(st or None)
    return out


def gradient_spec(
    ds: DataStruct, gradient_col: int | str, excluded: NDArray[np.bool_] | None = None
) -> dict[str, Any] | None:
    """The style keys a gradient Color-by lays on every encoded series -- the
    port of ``lib/plotEncoding.ts``'s ``encodedGradient``: the column's per-row
    values (``color_by``), its finite range over the request's rows (the rows
    the screen keeps: ``color_lim``), the screen's colormap stops
    (:data:`quantized.calc.figure_colorscatter.GRADIENT_STOPS`) and the
    colour-scale label ``"name (unit)"``. ``None`` when the column has no
    finite value, as the screen then colours nothing. ``excluded`` rows (a
    full-rows request's mask, ``calc.figure_excluded``) stay out of the range,
    since the screen takes it over the kept rows."""
    col = _check(ds, gradient_col, "gradient_col")
    z = ds.values[:, col]
    keep = np.isfinite(z) if excluded is None else np.isfinite(z) & ~excluded
    finite = z[keep]
    if finite.size == 0:
        return None
    unit = ds.units[col]
    return {
        "color_by": z.tolist(),
        "color_lim": [float(finite.min()), float(finite.max())],
        "color_stops": list(GRADIENT_STOPS),
        "colormap": "viridis",
        "colorbar_label": f"{ds.labels[col]} ({unit})" if unit else ds.labels[col],
    }
