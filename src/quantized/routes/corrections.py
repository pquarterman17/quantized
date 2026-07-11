"""Thin corrections route: DataStruct + params -> corrected DataStruct.

Validate, call ``calc.corrections.apply_corrections`` (the pure 8-step pipeline),
serialize. No algorithms here — the math lives in calc/. The request ``params``
mirror the MATLAB ``correctionParams`` struct (camelCase on the wire); the typed
model below is the API contract and is dumped back to that exact key set.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from quantized.calc.corrections import apply_corrections
from quantized.datastruct import DataStruct
from quantized.routes._payload import datastruct_payload

router = APIRouter(prefix="/api/corrections", tags=["corrections"])


class CorrectionParams(BaseModel):
    """Correction-pipeline parameters (all optional; mirror MATLAB ``params``).

    Wire names are camelCase (aliases); unset fields are dropped so the calc
    layer falls back to its own defaults (e.g. NaN ``xTrim*`` = no trim).
    """

    model_config = ConfigDict(populate_by_name=True)

    x_off: float | None = Field(default=None, alias="xOff")
    y_off: float | None = Field(default=None, alias="yOff")
    bg_slope: float | None = Field(default=None, alias="bgSlope")
    bg_int: float | None = Field(default=None, alias="bgInt")
    bg_poly: list[float] | None = Field(default=None, alias="bgPoly")
    x_trim_min: float | None = Field(default=None, alias="xTrimMin")
    x_trim_max: float | None = Field(default=None, alias="xTrimMax")
    is_neutron: bool | None = Field(default=None, alias="isNeutron")
    is_mag: bool | None = Field(default=None, alias="isMag")
    field_unit: str | None = Field(default=None, alias="fieldUnit")
    moment_unit: str | None = Field(default=None, alias="momentUnit")
    sample_mass: float | None = Field(default=None, alias="sampleMass")
    sample_volume: float | None = Field(default=None, alias="sampleVolume")
    smooth_enabled: bool | None = Field(default=None, alias="smoothEnabled")
    smooth_window: int | None = Field(default=None, alias="smoothWindow")
    smooth_method: str | None = Field(default=None, alias="smoothMethod")
    norm_method: str | None = Field(default=None, alias="normMethod")
    derivative_mode: str | None = Field(default=None, alias="derivativeMode")
    # GOTO additions (new features beyond MATLAB parity):
    # #2 anchor-point baseline subtraction ((x, y) pairs + interp method).
    bg_anchors: list[list[float]] | None = Field(default=None, alias="bgAnchors")
    bg_anchor_method: str | None = Field(default=None, alias="bgAnchorMethod")
    # #7b XRR/NR beam-footprint correction (beam width / sample length share
    # one length unit; footprintTwoTheta reads x as the detector angle 2theta).
    footprint_w: float | None = Field(default=None, alias="footprintW")
    footprint_l: float | None = Field(default=None, alias="footprintL")
    footprint_two_theta: bool | None = Field(default=None, alias="footprintTwoTheta")


class CorrectionsRequest(BaseModel):
    dataset: dict[str, Any]
    params: CorrectionParams = Field(default_factory=CorrectionParams)
    bg_dataset: dict[str, Any] | None = None
    bg_interp: str = "linear"


@router.post("/apply")
def apply(req: CorrectionsRequest) -> dict[str, Any]:
    """Apply the correction pipeline to a posted DataStruct."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        bg = DataStruct.from_dict(req.bg_dataset) if req.bg_dataset else None
        params = req.params.model_dump(by_alias=True, exclude_none=True)
        out = apply_corrections(ds, params, bg_dataset=bg, bg_interp=req.bg_interp)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return datastruct_payload(out)
