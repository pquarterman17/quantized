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

__all__ = [
    "PlotData",
    "PlotSeries",
    "PlotState",
    "build_grouped_series",
    "build_series",
    "resolve_style_channels",
    "validate_y2_subset",
]


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


def validate_y2_subset(
    y_keys: Sequence[int | str] | None, y2_keys: Sequence[int | str] | None
) -> None:
    """``y2_keys`` (the channels drawn on the secondary/right Y axis, MAIN
    y2-export-parity) must be a SUBSET of ``y_keys`` (the full plotted
    list) -- raises ``ValueError`` (the export route maps it to a 422)
    rather than silently intersecting or dropping the mismatched entries.
    ``y_keys is None`` means "every channel" (:func:`build_series`'s own
    default), so any ``y2_keys`` passes here; an out-of-range channel is
    still caught later by the normal channel-resolution error path
    (:func:`_resolve`, via ``ValueError``/``KeyError``/``IndexError``)."""
    if not y2_keys or y_keys is None:
        return
    y_set = set(y_keys)
    bad = [k for k in y2_keys if k not in y_set]
    if bad:
        raise ValueError(f"y2_keys must be a subset of y_keys (not in y_keys: {bad!r})")


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


def _format_level(level: float) -> str:
    """Format a group-column LEVEL value to match the frontend's
    ``${level}`` template-literal coercion (JS ``Number.prototype.
    toString``), NOT Python's ``str(float)`` -- the two diverge exactly on
    whole numbers: JS has one numeric type, so ``(2.0).toString() ===
    "2"``, while Python's float ``str``/``repr`` always shows the trailing
    ``.0`` (``str(2.0) == "2.0"``). Every other case (a genuinely
    fractional level) already matches -- both languages print the shortest
    round-trip decimal digits. See ``plans/GUI_INTERACTION_PLAN.md`` #12
    Slice 5: the level is the RAW numeric group value, never a resolved
    category text label -- ``buildXY`` doesn't resolve one either, so this
    port doesn't "improve" on it."""
    return str(int(level)) if float(level).is_integer() else str(level)


def build_grouped_series(
    ds: DataStruct,
    x_key: int | str | None,
    y_keys: Sequence[int | str],
    group_col: int | str,
) -> PlotData:
    """Faithful port of the frontend's ``lib/plotspec.ts`` ``buildXY``
    colour split (GUI_INTERACTION #12 Slice 5): each ``y_keys`` channel
    becomes one masked series PER LEVEL of ``group_col`` instead of one
    series per channel, so a Graph Builder "group" zone renders identically
    on screen and in a publication export. ``calc.figure.draw_series_axes``
    needs no changes for this -- it already renders an arbitrary
    ``series: Sequence[tuple[label, array]]`` with no concept of "channel"
    at all; the gap was entirely at this resolve step.

    Algorithm (matches ``buildXY`` exactly -- verified against the frontend
    source, not "improved"):
      - ``levels`` = the SORTED unique FINITE values of the group column
        (ascending numeric sort; a non-finite group value is dropped, never
        becomes its own level/series).
      - One series per ``(yChannel, level)`` pair, nested outer-to-inner as
        ``yChannel`` (in the given order) then ``level`` (sorted) -- this
        exact nesting is what keeps the screen and the export series lists
        aligned.
      - Each series value is the y value where the row's group column
        equals the level AND the y value is itself finite; NaN everywhere
        else (``buildXY`` uses ``null`` for the same rows -- the wire
        layer's existing NaN -> null conversion covers this series the
        same way it covers every other one; this pure layer stays NaN,
        like :func:`build_series`).
      - Label: ``f"{y_label} ({group_label}={level})"`` -- ``level`` is the
        RAW numeric group value (see :func:`_format_level`), never a
        resolved category text label.
      - Every series stays on axis 0 -- ``buildXY`` never assigns
        ``axis: 1`` to a grouped series; a request combining a group split
        with a secondary axis is rejected earlier, at the route layer
        (``routes.export_figures._figure_series``).

    Raises ``ValueError`` when ``group_col`` (or any entry of ``y_keys``/
    ``x_key``) doesn't resolve to a real channel -- caught by the same
    route-layer ``except (ValueError, ...)`` every other malformed channel
    index already goes through.
    """
    if x_key is None:
        x = ds.time
        x_label = str(ds.metadata.get("x_column_name", "x"))
        x_unit = str(ds.metadata.get("x_column_unit", ""))
    else:
        xi = _resolve(ds, x_key)
        x = ds.values[:, xi]
        x_label = ds.labels[xi]
        x_unit = ds.units[xi]

    gi = _resolve(ds, group_col)
    if not (0 <= gi < ds.n_channels):
        raise ValueError(f"group_col {group_col!r} is out of range")
    group_vals = ds.values[:, gi]
    finite_group = group_vals[np.isfinite(group_vals)]
    levels = np.sort(np.unique(finite_group))
    g_label = ds.labels[gi]

    series: list[PlotSeries] = []
    for yk in y_keys:
        yi = _resolve(ds, yk)
        y_label = ds.labels[yi]
        y_unit = ds.units[yi]
        y_vals = ds.values[:, yi]
        for lvl in levels:
            mask = (group_vals == lvl) & np.isfinite(y_vals)
            masked = np.where(mask, y_vals, np.nan)
            series.append(
                PlotSeries(
                    label=f"{y_label} ({g_label}={_format_level(float(lvl))})",
                    unit=y_unit,
                    values=np.asarray(masked, dtype=float),
                    axis=0,
                )
            )

    return PlotData(
        x=x,
        x_label=x_label,
        x_unit=x_unit,
        series=tuple(series),
        x_log=False,
        y_log=False,
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
