"""Pure plot-series builder: DataStruct + PlotState -> arrays ready for uPlot.

Pure layer — returns ndarrays; the wire (NaN -> null, column packing) is the
routes layer's job. No fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["PlotData", "PlotSeries", "PlotState", "build_series", "resolve_style_channels"]


@dataclass(frozen=True, slots=True)
class PlotState:
    """Minimal plot selection/config (M1 subset of the full W6 model).

    ``y2_keys`` names the channels drawn against a secondary (right) Y axis —
    the dual-Y feature. Channels not listed there default to the primary axis.
    """

    x_key: int | str | None = None
    y_keys: tuple[int | str, ...] | None = None
    y2_keys: tuple[int | str, ...] | None = None
    x_log: bool = False
    y_log: bool = False


@dataclass(frozen=True, slots=True)
class PlotSeries:
    label: str
    unit: str
    values: NDArray[np.float64]
    axis: int = 0  # 0 = primary (left) Y axis, 1 = secondary (right)


@dataclass(frozen=True, slots=True)
class PlotData:
    x: NDArray[np.float64]
    x_label: str
    x_unit: str
    series: tuple[PlotSeries, ...]
    x_log: bool
    y_log: bool


def _resolve(ds: DataStruct, key: int | str) -> int:
    return key if isinstance(key, int) else ds.labels.index(key)


def build_series(ds: DataStruct, state: PlotState | None = None) -> PlotData:
    """Select x + y channels per ``state``; default x = ds.time, y = all channels."""
    state = state or PlotState()

    if state.x_key is None:
        x = ds.time
        x_label = str(ds.metadata.get("x_column_name", "x"))
        x_unit = str(ds.metadata.get("x_column_unit", ""))
    else:
        xi = _resolve(ds, state.x_key)
        x = ds.values[:, xi]
        x_label = ds.labels[xi]
        x_unit = ds.units[xi]

    if state.y_keys is None:
        y_indices = list(range(ds.n_channels))
    else:
        y_indices = [_resolve(ds, k) for k in state.y_keys]

    y2 = {_resolve(ds, k) for k in state.y2_keys} if state.y2_keys is not None else set()
    series = tuple(
        PlotSeries(
            label=ds.labels[i],
            unit=ds.units[i],
            values=ds.values[:, i],
            axis=1 if i in y2 else 0,
        )
        for i in y_indices
    )
    return PlotData(
        x=x,
        x_label=x_label,
        x_unit=x_unit,
        series=series,
        x_log=state.x_log,
        y_log=state.y_log,
    )


def resolve_style_channels(
    ds: DataStruct,
    y_keys: Sequence[int | str] | None,
    series_styles: Sequence[Mapping[str, Any] | None] | None,
) -> list[dict[str, Any] | None] | None:
    """Resolve per-series style CHANNEL REFERENCES (MAIN #13's ``fill: {"vs":
    <channel>}`` and MAIN #14's ``color_by: <channel>``) against ``ds`` and
    the actual plotted channel order -- so ``calc.figure`` (and
    ``calc.figure_page``) never touch the raw ``DataStruct``, only resolved
    values (they stay format-only: numbers in, bytes out).

    ``fill.vs`` (a dataset channel index -- the SAME semantic the frontend's
    ``SeriesStyle.fill`` uses) resolves to the DISPLAY POSITION of that
    channel among the plotted series -- dropped silently (no band) when the
    channel isn't currently plotted, mirroring uPlot's own band mechanism,
    which can only fill between two DRAWN series (see the frontend's
    ``lib/uplotFill.ts``).

    ``color_by`` (a dataset channel index) resolves to that channel's
    concrete value array -- any channel, not required to be otherwise
    plotted, since it's an auxiliary z-column, not an x/y series pick.

    ``None`` (no styles requested) passes through unchanged; a malformed
    style dict entry is left as-is (rendering degrades gracefully -- an
    export must never 500 on a bad style hint).
    """
    if series_styles is None:
        return None
    plotted = list(range(ds.n_channels)) if y_keys is None else [_resolve(ds, k) for k in y_keys]
    out: list[dict[str, Any] | None] = []
    for spec in series_styles:
        if not spec:
            out.append(None)
            continue
        resolved: dict[str, Any] = dict(spec)  # shallow copy -- never mutate the caller's dict
        fill = resolved.get("fill")
        if isinstance(fill, Mapping) and "vs" in fill:
            try:
                vs_pos = plotted.index(int(fill["vs"]))
            except (ValueError, TypeError):
                resolved.pop("fill", None)
            else:
                resolved["fill"] = {"vs": vs_pos}
        color_by = resolved.get("color_by")
        if isinstance(color_by, int) and not isinstance(color_by, bool):
            if 0 <= color_by < ds.n_channels:
                resolved["color_by"] = ds.values[:, color_by].tolist()
            else:
                resolved.pop("color_by", None)
        out.append(resolved)
    return out
