"""Thin routes for XYZ gridding, map formulas and pixel extraction
(``calc/grid_xyz``, ``calc/map_formula``, ``calc/map_extract``).

Each returns a NEW DataStruct (a native-grid map, or a one-row-per-map
worksheet); the caller commits it as a derived dataset with provenance.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc import grid_xyz, map_extract, map_formula, map_ops
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload

router = APIRouter(prefix="/api/map-ops", tags=["map-ops"], route_class=OffloopJSONRoute)


class GridRequest(BaseModel):
    dataset: dict[str, Any]
    # Column index or label; -1 is the worksheet's X axis.
    x_col: int | str
    y_col: int | str
    z_col: int | str
    method: str = "natural"
    nx: int = Field(default=100, ge=2, le=2000)
    ny: int = Field(default=100, ge=2, le=2000)
    xmin: float | None = None
    xmax: float | None = None
    ymin: float | None = None
    ymax: float | None = None
    log_x: bool = False
    log_y: bool = False
    extrapolation: str = "none"
    output: str = "value"
    idw_power: float = 2.0
    smoothing: float = 0.0
    # modified Shepard
    shepard_radius: float | None = None
    shepard_neighbors: int = 19
    shepard_quadratic: bool = True
    # kriging
    variogram: str = "auto"
    krige_neighbors: int = 32


def _limits(lo: float | None, hi: float | None) -> tuple[float, float] | None:
    if lo is None and hi is None:
        return None
    if lo is None or hi is None:
        raise ValueError("give both limits of an axis, or neither")
    return lo, hi


@router.post("/grid", response_model=dict[str, Any], response_class=DataStructResponse)
def grid(req: GridRequest) -> Response:
    """Grid scattered X/Y/Z columns into a new map (or its kriging variance)."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        x, y, z, meta = grid_xyz.read_xyz(ds, req.x_col, req.y_col, req.z_col)
        res = grid_xyz.grid_xyz(
            x, y, z,
            method=req.method, nx=req.nx, ny=req.ny,
            xlim=_limits(req.xmin, req.xmax), ylim=_limits(req.ymin, req.ymax),
            log_x=req.log_x, log_y=req.log_y, extrapolation=req.extrapolation,
            idw_power=req.idw_power, smoothing=req.smoothing, output=req.output,
            options={
                "shepard_radius": req.shepard_radius,
                "shepard_neighbors": req.shepard_neighbors,
                "shepard_quadratic": req.shepard_quadratic,
                "variogram": req.variogram,
                "krige_neighbors": req.krige_neighbors,
            },
        )
        out = grid_xyz.grid_datastruct(
            res,
            x_label=meta[0][0], x_unit=meta[0][1],
            y_label=meta[1][0], y_unit=meta[1][1],
            z_unit=meta[2][1], output=req.output,
            metadata={"source": ds.metadata.get("source", ""), "z_column_name": meta[2][0]},
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(out))


class FormulaRequest(BaseModel):
    dataset: dict[str, Any]
    expr: str
    unit: str | None = None
    x_col: int | str | None = None
    y_col: int | str | None = None
    z_col: int | str | None = None


@router.post("/formula", response_model=dict[str, Any], response_class=DataStructResponse)
def formula(req: FormulaRequest) -> Response:
    """A new map whose values are ``expr(x, y, z)`` of the given map."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        g = map_ops.read_grid(ds, req.x_col, req.y_col, req.z_col)
        out, info = map_formula.map_formula(g, req.expr, unit=req.unit)
        result = map_ops.grid_result(out, info)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(result))


class NamedMap(BaseModel):
    name: str
    dataset: dict[str, Any]


class ExtractRequest(BaseModel):
    maps: list[NamedMap] = Field(min_length=1, max_length=2000)
    x: float
    y: float


@router.post("/extract", response_model=dict[str, Any], response_class=DataStructResponse)
def extract(req: ExtractRequest) -> Response:
    """The value at (x, y) in every map, one row per map (bilinear)."""
    try:
        grids = [
            (m.name, map_ops.read_grid(DataStruct.from_dict(m.dataset))) for m in req.maps
        ]
        result = map_extract.extract_pixel(grids, req.x, req.y)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(result))
