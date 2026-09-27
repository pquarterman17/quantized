"""Thin SIMS depth-profile processing route (audit P2.3). Wraps
``calc.sims_process``.

``POST /api/sims/process`` applies the chosen stages -- depth calibration,
background, reference normalization, smoothing -- to one posted dataset and
returns the derived dataset, the per-stage provenance and the plain-language
warnings the workshop previews before anything is created. Validate, call the
pure function, serialize: every formula and refusal lives in ``calc/``.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.sims_process import (
    BackgroundSpec,
    CalibrationSpec,
    NormalizationSpec,
    SmoothingSpec,
    process_sims,
)
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._payload import DataStructResponse, datastruct_payload

router = APIRouter(prefix="/api/sims", tags=["sims"])


class SimsCalibration(BaseModel):
    method: Literal["rate", "crater"]
    sputter_rate: float | None = None
    rate_unit: str = "nm/s"
    crater_depth: float | None = None
    crater_unit: str = "nm"
    #: Crater method: total sputter time, in x's time unit (default: last point).
    total_time: float | None = None
    depth_unit: str = "nm"
    #: The time unit x is in, stated by the user (overrides the recorded unit).
    time_unit: str | None = None


class SimsBackground(BaseModel):
    lo: float
    hi: float


class SimsNormalization(BaseModel):
    reference: int = Field(ge=0)
    #: One per column (the reference's entry is ignored); null = plain ratio.
    rsf: list[float | None] | None = None
    rsf_unit: str = ""


class SimsSmoothing(BaseModel):
    method: Literal["moving", "gaussian", "savitzky-golay"] = "moving"
    window: int = Field(default=2, ge=1, le=500)
    poly_order: int = Field(default=2, ge=0, le=10)


class SimsProcessRequest(BaseModel):
    dataset: dict[str, Any]
    calibration: SimsCalibration | None = None
    background: SimsBackground | None = None
    normalization: SimsNormalization | None = None
    smoothing: SimsSmoothing | None = None


class SimsWarning(BaseModel):
    code: str
    text: str
    count: int | None = None
    columns: list[str] | None = None
    confirm: bool | None = None
    info: bool | None = None


class SimsProcessResponse(BaseModel):
    dataset: dict[str, Any]
    warnings: list[SimsWarning]
    stages: list[dict[str, Any]]


@router.post("/process", response_model=SimsProcessResponse, response_class=DataStructResponse)
def process(req: SimsProcessRequest) -> Response:
    """Calibrate / correct a SIMS profile; warnings say what that did."""
    try:
        data = DataStruct.from_dict(req.dataset)
        cal = req.calibration
        res = process_sims(
            data,
            calibration=None if cal is None else CalibrationSpec(**cal.model_dump()),
            background=None
            if req.background is None
            else BackgroundSpec(lo=req.background.lo, hi=req.background.hi),
            normalization=None
            if req.normalization is None
            else NormalizationSpec(**req.normalization.model_dump()),
            smoothing=None
            if req.smoothing is None
            else SmoothingSpec(**req.smoothing.model_dump()),
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(
        {
            "dataset": datastruct_payload(res.data),
            "warnings": res.warnings,
            "stages": res.stages,
        }
    )
