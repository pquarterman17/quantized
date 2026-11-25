"""Thin spectroscopy-extras routes (GAP_AUDIT_9 G21): Fourier self-deconvolution,
Noda 2-D correlation and peak onset. Wraps ``calc.spectro_*``; bad input is a 422."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from quantized.calc.spectro_corr2d import correlation_maps
from quantized.calc.spectro_fsd import fourier_self_deconvolution
from quantized.calc.spectro_onset import peak_onset
from quantized.routes._errors import call_calc
from quantized.routes._payload import datastruct_payload, to_jsonable

router = APIRouter(prefix="/api/spectro", tags=["spectro"])


class FsdRequest(BaseModel):
    x: list[float]
    y: list[float]
    hwhm: float
    k: float
    apodization: Literal["triangular", "bessel"] = "triangular"


class Corr2dRequest(BaseModel):
    x: list[float]
    #: One spectrum per entry, in perturbation order, each the length of ``x``.
    spectra: list[list[float]]
    perturbation: list[float] | None = None
    x_label: str = "X"
    x_unit: str = ""
    x_min: float | None = None
    x_max: float | None = None


class OnsetRequest(BaseModel):
    x: list[float]
    y: list[float]
    side: Literal["left", "right"] = "left"
    x_min: float | None = None
    x_max: float | None = None
    baseline_min: float | None = None
    baseline_max: float | None = None
    fraction: float = 0.1
    smooth: int = 1


@router.post("/fsd")
def fsd(req: FsdRequest) -> dict[str, Any]:
    """Fourier self-deconvolution of Lorentzian bands of half-width ``hwhm``."""

    def run() -> dict[str, Any]:
        out, info = fourier_self_deconvolution(
            np.asarray(req.x), np.asarray(req.y), req.hwhm, req.k, req.apodization
        )
        return {"y": out, "info": info}

    return to_jsonable(call_calc(run))  # type: ignore[no-any-return]


@router.post("/corr2d")
def corr2d(req: Corr2dRequest) -> dict[str, Any]:
    """Synchronous and asynchronous maps (native-grid map datasets)."""

    def run() -> dict[str, Any]:
        if any(len(s) != len(req.x) for s in req.spectra):
            raise ValueError("every spectrum must have one value per x")
        sync, asyn, info = correlation_maps(
            np.asarray(req.x),
            np.asarray(req.spectra),
            req.perturbation,
            x_label=req.x_label,
            x_unit=req.x_unit,
            x_range=(req.x_min, req.x_max),
        )
        return {
            "synchronous": datastruct_payload(sync),
            "asynchronous": datastruct_payload(asyn),
            "info": info,
        }

    return call_calc(run)


@router.post("/onset")
def onset(req: OnsetRequest) -> dict[str, Any]:
    """Onset by tangent intersection and by threshold fraction."""

    def run() -> dict[str, Any]:
        if (req.baseline_min is None) != (req.baseline_max is None):
            raise ValueError("give both ends of the baseline range, or neither")
        base = (
            None if req.baseline_min is None else (req.baseline_min, float(req.baseline_max or 0))
        )
        return peak_onset(
            np.asarray(req.x),
            np.asarray(req.y),
            side=req.side,
            window=(req.x_min, req.x_max),
            baseline=base,
            fraction=req.fraction,
            smooth=req.smooth,
        )

    return to_jsonable(call_calc(run))  # type: ignore[no-any-return]
