"""Thin routes for the math extras: areas, interpolation, B-spline resampling,
2-D map correlation and the equation / optimisation solver.

Wrap ``calc.math_area``, ``calc.math_interp``, ``calc.map_correlate``,
``calc.math_solve``. Results that become a worksheet return a DataStruct (the
caller commits it with provenance); areas and solver results are plain JSON
result cards.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc import map_correlate, map_ops, math_area, math_interp, math_outputs, math_solve
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload

router = APIRouter(prefix="/api/math-extras", tags=["math-extras"], route_class=OffloopJSONRoute)

NonFinite = Literal["error", "drop"]


class Labels(BaseModel):
    x_label: str = "x"
    x_unit: str = ""
    y_label: str = "y"
    y_unit: str = ""


def _pair(x: list[float], y: list[float]) -> None:
    if len(x) != len(y):
        raise HTTPException(status_code=422, detail="X and Y must have the same length")


def _out(ds: DataStruct) -> Response:
    return DataStructResponse(datastruct_payload(ds))


class PolygonAreaRequest(BaseModel):
    x: list[float]
    y: list[float]
    nonfinite: NonFinite = "error"


class PolygonAreaResponse(BaseModel):
    area: float
    signed_area: float
    perimeter: float
    n_points: int
    dropped: int
    self_intersecting: bool | None


@router.post("/polygon-area", response_model=PolygonAreaResponse)
def polygon_area(req: PolygonAreaRequest) -> PolygonAreaResponse:
    """Area of the polygon through the points, closed by its endpoints."""
    _pair(req.x, req.y)
    res = call_calc(math_area.polygon_area, req.x, req.y, nonfinite=req.nonfinite)
    return PolygonAreaResponse(**asdict(res))


class SurfaceAreaRequest(BaseModel):
    dataset: dict[str, Any]
    x_col: int | str | None = None
    y_col: int | str | None = None
    z_col: int | str | None = None
    on_nan: Literal["error", "skip"] = "error"


class SurfaceAreaResponse(BaseModel):
    surface_area: float
    projected_area: float
    n_cells: int
    skipped_cells: int


@router.post("/surface-area", response_model=SurfaceAreaResponse)
def surface_area(req: SurfaceAreaRequest) -> SurfaceAreaResponse:
    """Surface area of a 2-D map."""

    def run() -> math_area.SurfaceArea:
        g = map_ops.read_grid(DataStruct.from_dict(req.dataset), req.x_col, req.y_col, req.z_col)
        return math_area.surface_area(g, on_nan=req.on_nan)

    return SurfaceAreaResponse(**asdict(call_calc(run)))


class TraceRequest(Labels):
    x: list[float]
    y: list[float]
    n: int | None = Field(default=None, ge=2)
    spacing: float | None = None
    at: list[float] | None = None
    kind: Literal["linear", "pchip", "cubic"] = "linear"
    periodic: bool = False


@router.post("/trace", response_model=dict[str, Any], response_class=DataStructResponse)
def trace(req: TraceRequest) -> Response:
    """Resample a curve (as a path) by arc length."""
    _pair(req.x, req.y)

    def run() -> DataStruct:
        r = math_interp.trace_interpolate(
            req.x,
            req.y,
            n=req.n,
            spacing=req.spacing,
            at=req.at,
            kind=req.kind,
            periodic=req.periodic,
        )
        return math_outputs.trace_datastruct(
            r,
            x_label=req.x_label,
            x_unit=req.x_unit,
            y_label=req.y_label,
            y_unit=req.y_unit,
            settings={"interp": req.kind, "periodic": req.periodic, "n_input": r.n_input},
        )

    return _out(call_calc(run))


class BSplineRequest(Labels):
    x: list[float]
    y: list[float]
    n: int | None = Field(default=None, ge=2)
    spacing: float | None = None
    degree: int = Field(default=3, ge=1, le=5)
    smoothing: float = Field(default=0.0, ge=0.0)


@router.post("/bspline", response_model=dict[str, Any], response_class=DataStructResponse)
def bspline(req: BSplineRequest) -> Response:
    """Fit a B-spline to y(x) and sample it on a regular grid."""
    _pair(req.x, req.y)

    def run() -> DataStruct:
        r = math_interp.bspline_resample(
            req.x, req.y, n=req.n, spacing=req.spacing, degree=req.degree, smoothing=req.smoothing
        )
        return math_outputs.bspline_datastruct(
            r,
            x_label=req.x_label,
            x_unit=req.x_unit,
            y_label=req.y_label,
            y_unit=req.y_unit,
            settings={},
        )

    return _out(call_calc(run))


class ScatterRequest(BaseModel):
    points: list[list[float]]
    values: list[float]
    queries: list[list[float]]
    method: Literal["linear", "nearest", "rbf"] = "linear"
    extrapolation: Literal["none", "nearest"] = "none"
    coord_labels: list[str] = Field(default_factory=list)
    coord_units: list[str] = Field(default_factory=list)
    value_label: str = "w"
    value_unit: str = ""


@router.post("/scatter", response_model=dict[str, Any], response_class=DataStructResponse)
def scatter(req: ScatterRequest) -> Response:
    """Interpolate scattered 2-D / 3-D data onto chosen points."""

    def run() -> DataStruct:
        r = math_interp.scattered_interpolate(
            req.points, req.values, req.queries, method=req.method, extrapolation=req.extrapolation
        )
        d = np.asarray(req.queries, dtype=float).shape[1]
        labels = (req.coord_labels + ["x", "y", "z"][len(req.coord_labels) :])[:d]
        units = (req.coord_units + [""] * d)[:d]
        return math_outputs.scatter_datastruct(
            r,
            req.queries,
            coord_labels=labels,
            coord_units=units,
            value_label=req.value_label,
            value_unit=req.value_unit,
            settings={"extrapolation": req.extrapolation},
        )

    return _out(call_calc(run))


class CorrelateRequest(BaseModel):
    dataset: dict[str, Any]
    other: dict[str, Any]
    on_nan: Literal["error", "zero"] = "error"
    subpixel: bool = True


@router.post("/correlate", response_model=dict[str, Any], response_class=DataStructResponse)
def correlate(req: CorrelateRequest) -> Response:
    """Normalised 2-D cross-correlation of two maps; the peak is in the metadata."""
    try:
        a = map_ops.read_grid(DataStruct.from_dict(req.dataset))
        b = map_ops.read_grid(DataStruct.from_dict(req.other))
        g, peak = map_correlate.correlate_maps(a, b, on_nan=req.on_nan, subpixel=req.subpixel)
        ds = math_outputs.correlation_datastruct(g, peak, {"on_nan": req.on_nan})
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _out(ds)


class RootRequest(BaseModel):
    expr: str = Field(max_length=2000)
    lo: float
    hi: float
    constants: dict[str, float] = Field(default_factory=dict)
    target: float = 0.0
    scan: int = Field(default=512, ge=8, le=100_000)


class RootResponse(BaseModel):
    roots: list[float]
    residuals: list[float]
    scanned: int
    poles_discarded: int


@router.post("/solve-root", response_model=RootResponse)
def solve_root(req: RootRequest) -> RootResponse:
    """Every root of ``expr(x) = target`` inside ``[lo, hi]``."""
    res = call_calc(
        math_solve.solve_root,
        req.expr,
        req.lo,
        req.hi,
        req.constants,
        target=req.target,
        scan=req.scan,
    )
    return RootResponse(**asdict(res))


class OptimizeRequest(BaseModel):
    expr: str = Field(max_length=2000)
    bounds: dict[str, tuple[float, float]]
    sense: Literal["min", "max"] = "min"
    starts: int = Field(default=8, ge=1, le=200)


class OptimizeResponse(BaseModel):
    variables: list[str]
    point: list[float]
    value: float
    sense: str
    converged: bool
    starts: int
    starts_agreeing: int
    at_bound: list[str]


@router.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    """Minimise (or maximise) ``expr`` over a bounded box."""
    res = call_calc(
        math_solve.optimize_box, req.expr, req.bounds, sense=req.sense, starts=req.starts
    )
    return OptimizeResponse(**asdict(res))
