"""Thin plot route: DataStruct + selection -> uPlot column-oriented payload."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, model_validator

from quantized.calc.decimate import decimate_columns, is_ascending, window_columns
from quantized.calc.map import MapState, map_from_datastruct
from quantized.calc.plotting import PlotState, build_series
from quantized.datastruct import DataStruct
from quantized.routes._datasetcache import CachedDatasetRequest, resolve_or_409
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import jsonify, to_jsonable

router = APIRouter(prefix="/api/plot", tags=["plot"])


class PlotRequest(BaseModel):
    dataset: dict[str, Any]
    x_key: int | str | None = None
    y_keys: list[int | str] | None = None
    y2_keys: list[int | str] | None = None
    x_log: bool = False
    y_log: bool = False
    # P3.4 server-side payload decimation: a target pixel-width / bucket-count
    # hint reflecting the client's actual draw contract (calc/decimate.py
    # mirrors the semantics of the frontend's lib/plotDecimate.ts exactly, so
    # a decimated series draws IDENTICALLY to full data in uPlot). None (the
    # default -- every pre-existing caller) returns full resolution, unchanged.
    decimate_width: int | None = Field(default=None, ge=1, le=20_000)
    # Explicit opt-out: force full resolution even when decimate_width is set.
    # No current caller needs both at once, but the contract stays honest for
    # any future one (e.g. an analysis consumer that reuses this route).
    full_resolution: bool = False
    # P3.4 zoom-refetch residual: the committed X view window of a follow-up
    # request re-fetching an already-decimated payload at full local detail
    # (calc/decimate.py's window_columns runs BEFORE decimate_columns, so the
    # bucketing re-derives extrema over only the visible rows). None (the
    # default) applies no window -- every pre-existing caller is unaffected.
    x_min: float | None = None
    x_max: float | None = None

    # NOTE: a non-finite x_min/x_max is deliberately NOT rejected here (no
    # `math.isfinite` check) -- raising from a validator embeds the raw
    # invalid value in the pydantic error detail, and Starlette's default
    # JSONResponse encoder disallows NaN, which turns a would-be 422 into an
    # unrelated 500 while rendering the error body. window_columns's own NaN
    # comparisons already resolve a non-finite bound to "no rows match" (see
    # its doc), and the `window` echo below goes through `to_jsonable` (NaN ->
    # null on the wire) -- so a non-finite bound degrades to a well-defined
    # empty result instead of crashing either path.
    @model_validator(mode="after")
    def _window_bounds_paired(self) -> PlotRequest:
        if (self.x_min is None) != (self.x_max is None):
            raise ValueError("x_min and x_max must be provided together")
        return self


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
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    x = plot.x
    values = [s.values for s in plot.series]

    # P3.4 zoom-refetch residual: filter to the requested view window BEFORE
    # decimation, so a follow-up windowed request re-buckets only the visible
    # rows instead of the whole series (see calc/decimate.py's window_columns
    # doc). `window` echoes back what was actually applied so the client can
    # verify a (possibly late-arriving) response still matches the window it
    # currently has committed, rather than trusting request/response pairing
    # alone.
    window: dict[str, float | None] | None = None
    if req.x_min is not None and req.x_max is not None:
        x, values = window_columns(x, values, req.x_min, req.x_max)
        window = to_jsonable({"x_min": req.x_min, "x_max": req.x_max})

    # A non-ascending x (e.g. a hysteresis-loop sweep) renders via the
    # acquisition-order path, which index-bucketing does not preserve (see
    # calc/decimate.py's is_ascending doc) -- refuse to decimate regardless
    # of what the client asked for, rather than ship a misleading envelope.
    decimate_width = req.decimate_width
    decimated = decimate_width is not None and not req.full_resolution and is_ascending(x)
    if decimated and decimate_width is not None:
        x, values = decimate_columns(x, values, decimate_width)

    # uPlot wants column-oriented data: [xValues, series1Values, series2Values, ...]
    data = [jsonify(x)] + [jsonify(v) for v in values]
    return {
        "data": data,
        "series": [{"label": s.label, "unit": s.unit, "axis": s.axis} for s in plot.series],
        "x": {"label": plot.x_label, "unit": plot.x_unit, "log": plot.x_log},
        "y": {"log": plot.y_log},
        "decimated": decimated,
        "window": window,
    }


class MapRequest(CachedDatasetRequest):
    """Three channels of a (scattered) dataset -> a regular 2-D grid for heatmap.

    ``dataset``/``dataset_handle`` (RSM_CUTS_PLAN item 18): the map fetch is
    the single largest repeat-payload offender (measured 45.5 MB on the
    largest real corpus file, re-sent on every channel change and every
    2theta/omega <-> Q toggle) -- see CachedDatasetRequest's own doc.
    """

    x_key: int | str
    y_key: int | str
    z_key: int | str
    # "auto" (RSM_CUTS_PLAN item 16) mirrors MapState's own default -- see
    # calc/map.py's MapState docstring; a caller that omits `method` gets the
    # size/grid-detection auto-select, not the (sometimes 57x slower) MATLAB-
    # parity "natural" algorithm.
    method: str = "auto"
    nx: int = Field(default=200, ge=2, le=2000)
    ny: int = Field(default=200, ge=2, le=2000)
    xlim: tuple[float, float] | None = None
    ylim: tuple[float, float] | None = None
    extrapolation: str = "none"
    smoothing: float = 0.0
    idw_power: float = 2.0


@router.post("/map")
def plot_map(req: MapRequest, response: Response) -> dict[str, Any]:
    """Regrid scattered (x, y, z) channels into a Canvas2D-ready heatmap grid."""
    try:
        ds, handle = resolve_or_409(req)
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
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    response.headers["X-Dataset-Handle"] = handle
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
