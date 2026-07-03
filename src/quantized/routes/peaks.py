"""Thin peak routes. ``/find`` wraps ``calc.peaks.find_peaks_robust`` (golden vs
MATLAB findPeaksRobust); ``/fit`` wraps ``calc.peak_fit.fit_single_peak`` (golden
vs fitSinglePeak); ``/fit-multi`` wraps ``calc.peak_multifit.fit_multi_peak``
(golden vs peakAnalysis.onFitSimultaneous). Validate -> call -> serialize; no
business logic here.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.peak_batch import batch_integrate_peaks
from quantized.calc.peak_fit import MODELS, fit_single_peak
from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.peak_multifit import fit_multi_peak
from quantized.calc.peaks import find_peaks_robust
from quantized.routes._payload import jsonify, to_jsonable

# Models accepted by the simultaneous fit (compositeEval branches).
MULTI_MODELS = ("Lorentzian", "Gaussian", "Pseudo-Voigt", "Split Pearson VII", "TCH-pV")
LINK_MODES = ("None", "Shared FWHM", "Shared FWHM + eta")

router = APIRouter(prefix="/api/peaks", tags=["peaks"])


class FindPeaksRequest(BaseModel):
    x: list[float]
    y: list[float]
    snr_threshold: float = 5.0
    min_separation: float = 0.0
    max_peaks: int = 50
    max_window_deg: float = 2.0
    min_width_deg: float = 0.01
    max_width_deg: float = 10.0
    min_prominence: float = 0.02
    sensitivity: str = "medium"


@router.post("/find")
def find(req: FindPeaksRequest) -> dict[str, Any]:
    """Find peaks in (x, y); returns the peak list + the estimated background."""
    try:
        peaks, background = find_peaks_robust(
            req.x,
            req.y,
            snr_threshold=req.snr_threshold,
            min_separation=req.min_separation,
            max_peaks=req.max_peaks,
            max_window_deg=req.max_window_deg,
            min_width_deg=req.min_width_deg,
            max_width_deg=req.max_width_deg,
            min_prominence=req.min_prominence,
            sensitivity=req.sensitivity,
        )
    except (ValueError, IndexError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"peaks": to_jsonable(peaks), "background": jsonify(background)}


class FitPeakRequest(BaseModel):
    x: list[float]
    y: list[float]
    x_lo: float
    x_hi: float
    seed_center: float
    seed_fwhm: float | None = None
    model: str = "Lorentzian"
    snip_bg: list[float] | None = None


@router.post("/fit")
def fit(req: FitPeakRequest) -> dict[str, Any]:
    """Fit one peak in [x_lo, x_hi] to ``model``; returns the fit result dict."""
    if req.model not in MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")
    try:
        result = fit_single_peak(
            req.x, req.y, req.x_lo, req.x_hi,
            seed_center=req.seed_center,
            seed_fwhm=float("nan") if req.seed_fwhm is None else req.seed_fwhm,
            model=req.model,
            snip_bg=req.snip_bg,
        )
    except (ValueError, IndexError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out: dict[str, Any] = to_jsonable(result)
    return out


class PeakSeed(BaseModel):
    center: float
    fwhm: float
    height: float
    eta: float | None = None


class FitMultiPeakRequest(BaseModel):
    x: list[float]
    y: list[float]
    peaks: list[PeakSeed]
    model: str = "Lorentzian"
    bg_degree: int = 1
    constrain: bool = False
    link_mode: str = "None"


@router.post("/fit-multi")
def fit_multi(req: FitMultiPeakRequest) -> dict[str, Any]:
    """Fit all ``peaks`` + a polynomial background simultaneously; returns the
    global-fit result (fitted peaks, bg coeffs, R2/rmse)."""
    if req.model not in MULTI_MODELS:
        raise HTTPException(status_code=422, detail=f"unknown model: {req.model}")
    if req.link_mode not in LINK_MODES:
        raise HTTPException(status_code=422, detail=f"unknown link_mode: {req.link_mode}")
    if not req.peaks:
        raise HTTPException(status_code=422, detail="need at least one peak seed")
    seeds = [p.model_dump(exclude_none=True) for p in req.peaks]
    try:
        result = fit_multi_peak(
            req.x, req.y, seeds,
            model=req.model, bg_degree=req.bg_degree,
            constrain=req.constrain, link_mode=req.link_mode,
        )
    except (ValueError, IndexError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out: dict[str, Any] = to_jsonable(result)
    return out


class IntegrateRequest(BaseModel):
    x: list[float]
    y: list[float]
    regions: list[tuple[float, float]]
    baseline: str = "linear"


@router.post("/integrate")
def integrate(req: IntegrateRequest) -> dict[str, Any]:
    """Integrate-only peak analysis: area/centroid/FWHM/%-area per region."""
    try:
        return to_jsonable(  # type: ignore[no-any-return]
            integrate_peaks(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                [(float(a), float(b)) for a, b in req.regions],
                baseline=req.baseline,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class BatchIntegrateRequest(BaseModel):
    x: list[float]
    spectra: list[list[float]]  # each same length as x
    regions: list[tuple[float, float]]
    baseline: str = "linear"
    align: bool = False
    reference: int = 0
    labels: list[str] | None = None


@router.post("/integrate-batch")
def integrate_batch(req: BatchIntegrateRequest) -> dict[str, Any]:
    """Integrate fixed regions across a spectra series (optional alignment).

    Returns per-spectrum results + area/centroid/FWHM matrices for trend
    plotting; a failing spectrum is flagged, not fatal."""
    try:
        return to_jsonable(  # type: ignore[no-any-return]
            batch_integrate_peaks(
                np.asarray(req.x, dtype=float),
                [np.asarray(s, dtype=float) for s in req.spectra],
                [(float(a), float(b)) for a, b in req.regions],
                baseline=req.baseline, align=req.align,
                reference=req.reference, labels=req.labels,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
