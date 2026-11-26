"""Spectral routes for the ROI gadget and dataset-level analysis workbench.

The compact ``/fft`` route serves a single ROI record. ``/workbench`` adapts a
full :class:`~quantized.datastruct.DataStruct` to the strict dataset contract
in :mod:`quantized.calc.spectral_workbench`. The "complex" FFT output never
crosses the wire because numpy complex values are not JSON serializable.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from quantized.calc.spectral import fft_spectral
from quantized.calc.spectral_workbench import spectral_workbench
from quantized.calc.spectrogram import spectrogram_dataset
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
    # PSD only: per frequency unit ("density", default) or per bin ("spectrum").
    scaling: Literal["density", "spectrum"] = "density"


class IirRequest(BaseModel):
    """IIR design for the workbench ``filter`` operation (scipy SOS)."""

    model_config = ConfigDict(extra="forbid")

    family: Literal["butter", "cheby1", "cheby2", "ellip", "bessel"]
    btype: Literal["lowpass", "highpass", "bandpass", "bandstop"]
    order: StrictInt = Field(ge=1, le=20)
    cutoff: list[float]
    rp: float | None = Field(default=None, gt=0)
    rs: float | None = Field(default=None, gt=0)
    bessel_norm: Literal["phase", "delay", "mag"] = "phase"
    zero_phase: bool = False


class SpectralWorkbenchRequest(BaseModel):
    dataset: dict[str, Any]
    secondary_dataset: dict[str, Any] | None = None
    secondary_channel: StrictInt | None = Field(default=None, ge=0)
    secondary_name: str | None = None
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
    iir: IirRequest | None = None
    psd_scaling: Literal["density", "spectrum"] = "density"


class SpectrogramRequest(BaseModel):
    dataset: dict[str, Any]
    channel: StrictInt = Field(ge=0)
    segment_len: StrictInt = Field(ge=1)
    window: str = "hann"
    overlap: float = Field(default=0.5, ge=0.0, lt=1.0)
    scaling: str = "psd"
    detrend: str = "mean"
    x_min: float | None = None
    x_max: float | None = None
    resample: bool = False


@router.post("/fft")
def fft(req: FftRequest) -> dict[str, Any]:
    """Single-record FFT spectrum (magnitude/psd/phase) of (x, y)."""
    if req.output_type not in _OUTPUT_TYPES:
        raise HTTPException(status_code=422, detail=f"unsupported output_type: {req.output_type}")
    if req.scaling != "density" and req.output_type != "psd":
        raise HTTPException(status_code=422, detail="power scaling applies only to PSD output")
    try:
        result = fft_spectral(
            np.asarray(req.x, dtype=float),
            np.asarray(req.y, dtype=float),
            window=req.window,
            output_type=req.output_type,
            sided=req.sided,
            detrend=req.detrend,
            scaling=req.scaling,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # Drop the window-function array: same length as the input, internal detail
    # the caller never plots (keeps the response small).
    out = {k: v for k, v in result.items() if k != "window"}
    if req.output_type == "psd":
        out["scaling"] = req.scaling  # which of the two PSD normalisations this is
    return to_jsonable(out)  # type: ignore[no-any-return]


@router.post("/workbench", response_model=dict[str, Any], response_class=DataStructResponse)
def workbench(req: SpectralWorkbenchRequest) -> DataStructResponse:
    """Run a dataset-level FFT, filter, or cross-correlation workflow."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        secondary_ds = (
            DataStruct.from_dict(req.secondary_dataset)
            if req.secondary_dataset is not None
            else None
        )
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
            secondary_ds=secondary_ds,
            secondary_channel=req.secondary_channel,
            secondary_name=req.secondary_name,
            iir=req.iir.model_dump() if req.iir is not None else None,
            psd_scaling=req.psd_scaling,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(out))


@router.post("/spectrogram", response_model=dict[str, Any], response_class=DataStructResponse)
def spectrogram(req: SpectrogramRequest) -> DataStructResponse:
    """Short-time Fourier transform of one channel as a long-form map table."""
    try:
        out = spectrogram_dataset(
            DataStruct.from_dict(req.dataset),
            channel=req.channel,
            segment_len=req.segment_len,
            window=req.window,
            overlap=req.overlap,
            scaling=req.scaling,
            detrend=req.detrend,
            x_min=req.x_min,
            x_max=req.x_max,
            resample=req.resample,
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DataStructResponse(datastruct_payload(out))
