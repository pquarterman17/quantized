"""Thin plot route: DataStruct + selection -> uPlot column-oriented payload."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.map import MapState, map_from_datastruct
from quantized.calc.plotting import PlotState, build_series
from quantized.datastruct import DataStruct
from quantized.routes._payload import jsonify, to_jsonable

router = APIRouter(prefix="/api/plot", tags=["plot"])


class PlotRequest(BaseModel):
    dataset: dict[str, Any]
    x_key: int | str | None = None
    y_keys: list[int | str] | None = None
    y2_keys: list[int | str] | None = None
    x_log: bool = False
    y_log: bool = False


@router.post("/series")
def plot_series(req: PlotRequest) -> dict[str, Any]:
    """Build uPlot-ready series from a posted DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        state = PlotState(
            x_key=req.x_key,
            y_keys=tuple(req.y_keys) if req.y_keys is not None else None,
            y2_keys=tuple(req.y2_keys) if req.y2_keys is not None else None,
            x_log=req.x_log,
            y_log=req.y_log,
        )
        plot = build_series(ds, state)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # uPlot wants column-oriented data: [xValues, series1Values, series2Values, ...]
    data = [jsonify(plot.x)] + [jsonify(s.values) for s in plot.series]
    return {
        "data": data,
        "series": [{"label": s.label, "unit": s.unit, "axis": s.axis} for s in plot.series],
        "x": {"label": plot.x_label, "unit": plot.x_unit, "log": plot.x_log},
        "y": {"log": plot.y_log},
    }


class MapRequest(BaseModel):
    """Three channels of a (scattered) dataset -> a regular 2-D grid for heatmap."""

    dataset: dict[str, Any]
    x_key: int | str
    y_key: int | str
    z_key: int | str
    method: str = "natural"
    nx: int = Field(default=200, ge=2, le=2000)
    ny: int = Field(default=200, ge=2, le=2000)
    xlim: tuple[float, float] | None = None
    ylim: tuple[float, float] | None = None
    extrapolation: str = "none"
    smoothing: float = 0.0
    idw_power: float = 2.0


@router.post("/map")
def plot_map(req: MapRequest) -> dict[str, Any]:
    """Regrid scattered (x, y, z) channels into a Canvas2D-ready heatmap grid."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        state = MapState(
            method=req.method,
            nx=req.nx,
            ny=req.ny,
            xlim=req.xlim,
            ylim=req.ylim,
            extrapolation=req.extrapolation,
            smoothing=req.smoothing,
            idw_power=req.idw_power,
        )
        m = map_from_datastruct(ds, req.x_key, req.y_key, req.z_key, state)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # x_axis/y_axis are regular (finite by construction); z_grid has NaN gaps
    # outside the convex hull -> jsonify maps those to null (a heatmap gap).
    return {
        "x_axis": jsonify(m.x_axis),
        "y_axis": jsonify(m.y_axis),
        "z_grid": jsonify(m.z_grid),
        "x": {"label": m.x_label, "unit": m.x_unit},
        "y": {"label": m.y_label, "unit": m.y_unit},
        "z": {
            "label": m.z_label,
            "unit": m.z_unit,
            "min": to_jsonable(m.z_min),
            "max": to_jsonable(m.z_max),
        },
    }
