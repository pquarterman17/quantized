"""Thin SIMS depth-profile routes (audit P2.3). Wrap ``calc.sims_process``,
``calc.sims_compare`` and ``calc.sims_region``.

``POST /api/sims/process`` applies the chosen stages -- depth calibration,
background, reference normalization, smoothing -- to one posted dataset and
returns the derived dataset, the per-stage provenance and the plain-language
warnings the workshop previews before anything is created. Validate, call the
pure function, serialize: every formula and refusal lives in ``calc/``.

``POST /api/sims/compare`` lays several profiles' chosen species side by side
in one derived comparison table (row blocks, nothing interpolated), and
``POST /api/sims/region`` measures each species over a depth region (dose,
peak, mean, junction depth) and returns the same result as a provenance-
stamped CSV.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.calc.sims_compare import compare_profiles
from quantized.calc.sims_process import (
    BackgroundSpec,
    CalibrationSpec,
    NormalizationSpec,
    SmoothingSpec,
    process_sims,
)
from quantized.calc.sims_region import region_measures, region_summary_csv
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
    #: Column indices left unchanged (the normalization reference always is).
    keep: list[int] = Field(default_factory=list)


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
            else BackgroundSpec(
                lo=req.background.lo, hi=req.background.hi, keep=tuple(req.background.keep)
            ),
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


class SimsProfileIn(BaseModel):
    #: The profile's display name (labels its traces; recorded in provenance).
    name: str
    dataset: dict[str, Any]


class SimsCompareRequest(BaseModel):
    profiles: list[SimsProfileIn] = Field(min_length=1)
    #: Species (column names) to compare; each profile contributes those it has.
    species: list[str] = Field(min_length=1)


class SimsCompareResponse(BaseModel):
    dataset: dict[str, Any]
    warnings: list[SimsWarning]
    traces: list[dict[str, Any]]


@router.post("/compare", response_model=SimsCompareResponse, response_class=DataStructResponse)
def compare(req: SimsCompareRequest) -> Response:
    """Several profiles' species in one comparison table (row blocks)."""
    try:
        profiles = [(p.name, DataStruct.from_dict(p.dataset)) for p in req.profiles]
        res = compare_profiles(profiles, req.species)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(
        {"dataset": datastruct_payload(res.data), "warnings": res.warnings, "traces": res.traces}
    )


class SimsRegionRequest(BaseModel):
    dataset: dict[str, Any]
    #: The dataset's display name, written into the CSV's provenance lines.
    dataset_name: str = ""
    lo: float
    hi: float
    #: Column indices to measure; null = every non-categorical column.
    columns: list[int] | None = None
    threshold_mode: Literal["fraction", "absolute"] = "fraction"
    #: A fraction of each species' peak (0..1, exclusive), or an absolute value.
    threshold: float = 0.5


class SimsCrossing(BaseModel):
    depth: float
    direction: Literal["rising", "falling"]


class SimsRegionSpecies(BaseModel):
    name: str
    unit: str
    points: int
    blank: int
    integral: float | None
    integral_unit: str
    integral_kind: Literal["areal-dose", "raw"]
    integrated_from: float | None
    integrated_to: float | None
    peak: float | None
    peak_depth: float | None
    mean: float | None
    threshold: float | None
    crossings: list[SimsCrossing]
    junction_depth: float | None
    junction_direction: Literal["rising", "falling"] | None


class SimsRegionResponse(BaseModel):
    region: list[float]
    x_name: str
    x_unit: str
    rows_in_region: int
    method: dict[str, Any]
    species: list[SimsRegionSpecies]
    warnings: list[SimsWarning]
    #: The same measures as CSV, with ``#`` provenance lines first.
    csv: str


@router.post("/region", response_model=SimsRegionResponse)
def region(req: SimsRegionRequest) -> dict[str, Any]:
    """Dose, peak, mean and junction depth per species over one region."""
    try:
        data = DataStruct.from_dict(req.dataset)
        res = region_measures(
            data, lo=req.lo, hi=req.hi, columns=req.columns,
            threshold_mode=req.threshold_mode, threshold=req.threshold,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {**res, "csv": region_summary_csv(res, dataset=req.dataset_name)}
