"""Thin route for general 2-D map analysis (``calc/map_peaks``, ``calc/map_volume``).

Validate, call, serialize. Each endpoint returns a small table DataStruct (one
row per peak / one row for the ROI) whose metadata carries the full result and
settings, so the caller commits it as a derived dataset with provenance.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.map_peaks import map_peaks_from_datastruct, peak_table_datastruct
from quantized.calc.map_volume import map_volume_from_datastruct, volume_table_datastruct
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload

router = APIRouter(prefix="/api/map-analysis", tags=["map-analysis"], route_class=OffloopJSONRoute)


class _MapRequest(BaseModel):
    dataset: dict[str, Any]
    x_col: int | str | None = None
    y_col: int | str | None = None
    z_col: int | str | None = None


class PeaksRequest(_MapRequest):
    n_peaks: int | None = Field(default=None, ge=1, le=100)
    threshold: float = Field(default=0.05, ge=0.0, lt=1.0)
    min_separation: int = Field(default=4, ge=1)
    model: Literal["gaussian", "lorentzian"] = "gaussian"
    rotate: bool = False
    smooth_sigma: float = Field(default=1.0, ge=0.0)
    fit_window: int = Field(default=8, ge=3)


class VolumeRequest(_MapRequest):
    region: dict[str, Any]
    background: dict[str, Any] | None = None
    border: int = Field(default=2, ge=1)
    on_nan: Literal["refuse", "skip"] = "refuse"


@router.post("/peaks", response_model=dict[str, Any], response_class=DataStructResponse)
def peaks(req: PeaksRequest) -> Response:
    """Find and fit the peaks of a map -> a peak table; 422 with the reason on bad input."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        result = map_peaks_from_datastruct(
            ds,
            req.x_col,
            req.y_col,
            req.z_col,
            n_peaks=req.n_peaks,
            threshold=req.threshold,
            min_separation=req.min_separation,
            model=req.model,
            rotate=req.rotate,
            smooth_sigma=req.smooth_sigma,
            fit_window=req.fit_window,
        )
        table = peak_table_datastruct(result)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(table))


@router.post("/volume", response_model=dict[str, Any], response_class=DataStructResponse)
def volume(req: VolumeRequest) -> Response:
    """Integrate a map over a rectangle or polygon -> a one-row table."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        result = map_volume_from_datastruct(
            ds,
            req.region,
            req.background,
            x_col=req.x_col,
            y_col=req.y_col,
            z_col=req.z_col,
            border=req.border,
            on_nan=req.on_nan,
        )
        table = volume_table_datastruct(result)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(table))
