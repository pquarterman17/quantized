"""Pure plot-series builder: DataStruct + PlotState -> arrays ready for uPlot.

Pure layer — returns ndarrays; the wire (NaN -> null, column packing) is the
routes layer's job. No fastapi/pydantic imports.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["PlotData", "PlotSeries", "PlotState", "build_series"]


@dataclass(frozen=True, slots=True)
class PlotState:
    """Minimal plot selection/config (M1 subset of the full W6 model)."""

    x_key: int | str | None = None
    y_keys: tuple[int | str, ...] | None = None
    x_log: bool = False
    y_log: bool = False


@dataclass(frozen=True, slots=True)
class PlotSeries:
    label: str
    unit: str
    values: NDArray[np.float64]


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

    series = tuple(
        PlotSeries(label=ds.labels[i], unit=ds.units[i], values=ds.values[:, i])
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
