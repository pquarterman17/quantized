"""Thin plot route: DataStruct + selection -> uPlot column-oriented payload."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.plotting import PlotState, build_series
from quantized.datastruct import DataStruct
from quantized.routes._payload import jsonify

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
