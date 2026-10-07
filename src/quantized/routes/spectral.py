"""Spectral routes for the ROI gadget and dataset-level analysis workbench.

The compact ``/fft`` route serves a single ROI record. ``/workbench`` adapts a
full :class:`~quantized.datastruct.DataStruct` to the strict dataset contract
in :mod:`quantized.calc.spectral_workbench`. The "complex" FFT output never
crosses the wire because numpy complex values are not JSON serializable.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StrictInt

from quantized.calc.spectral import fft_spectral
from quantized.calc.spectral_workbench import spectral_workbench
from quantized.datastruct import DataStruct
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes._payload import DataStructResponse, datastruct_payload, to_jsonable

router = APIRouter(prefix="/api/spectral", tags=["spectral"], route_class=OffloopJSONRoute)

# "complex" is deliberately excluded (see module docstring).
_OUTPUT_TYPES = ("psd", "magnitude", "phase")


class FftRequest(BaseModel):
    x: list[float]
    y: list[float]
    window: str = "hanning"
    output_type: str = "magnitude"
    sided: str = "one"
    detrend: str = "mean"


class SpectralWorkbenchRequest(BaseModel):
    dataset: dict[str, Any]
    operation: str
    channels: list[StrictInt]
    x_min: float | None = None
    x_max: float | None = None
    resample: bool = False
    output_type: str = "magnitude"
    sided: str = "one"
    window: str | None = None
    detrend: str = "mean"
    zero_pad: StrictInt = Field(default=0, ge=0)
    segment_len: StrictInt = Field(default=0, ge=0)
    overlap: float = Field(default=0.5, ge=0.0, lt=1.0)
    filter_type: str = "lowpass"
    cutoff: list[float] | None = None
    bandwidth: float | None = Field(default=None, gt=0)
    order: StrictInt = Field(default=4, ge=1, le=20)
    correlation_demean: bool = True
    include_diagnostics: bool = False


@router.post("/fft")
def fft(req: FftRequest) -> dict[str, Any]:
    """Single-record FFT spectrum (magnitude/psd/phase) of (x, y)."""
    if req.output_type not in _OUTPUT_TYPES:
        raise HTTPException(status_code=422, detail=f"unsupported output_type: {req.output_type}")
    try:
        result = fft_spectral(
            np.asarray(req.x, dtype=float),
            np.asarray(req.y, dtype=float),
            window=req.window,
            output_type=req.output_type,
            sided=req.sided,
            detrend=req.detrend,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # Drop the window-function array: same length as the input, internal detail
    # the caller never plots (keeps the response small).
    out = {k: v for k, v in result.items() if k != "window"}
    return to_jsonable(out)  # type: ignore[no-any-return]


@router.post("/workbench", response_model=dict[str, Any], response_class=DataStructResponse)
def workbench(req: SpectralWorkbenchRequest) -> DataStructResponse:
    """Run a dataset-level FFT, filter, or cross-correlation workflow."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        out = spectral_workbench(
            ds,
            operation=req.operation,
            channels=list(req.channels),
            x_min=req.x_min,
            x_max=req.x_max,
            resample=req.resample,
            output_type=req.output_type,
            sided=req.sided,
            window=req.window,
            detrend=req.detrend,
            zero_pad=req.zero_pad,
            segment_len=req.segment_len,
            overlap=req.overlap,
            filter_type=req.filter_type,
            cutoff=req.cutoff,
            bandwidth=req.bandwidth,
            order=req.order,
            correlation_demean=req.correlation_demean,
            include_diagnostics=req.include_diagnostics,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(out))
