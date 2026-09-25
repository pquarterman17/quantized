"""Thin peak routes. ``/find`` wraps ``calc.peaks.find_peaks_robust`` (golden vs
MATLAB findPeaksRobust); ``/fit`` wraps ``calc.peak_fit.fit_single_peak`` (golden
vs fitSinglePeak); ``/fit-multi`` wraps ``calc.peak_multifit.fit_multi_peak``
(golden vs peakAnalysis.onFitSimultaneous); ``/model-fit`` wraps
``calc.peak_model_fit.fit_peak_model`` (audit P2.4: mixed shapes, per-parameter
start/vary/bounds/ties, metrics and warnings; new capability, not golden). It
runs SYNCHRONOUSLY under a deadline capped at 30 s, the same budget as
``/api/reflectivity/fit``; the slice-2 UI may move long fits onto the job queue.
Validate -> call -> serialize; no business logic here.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.peak_batch import batch_integrate_peaks
from quantized.calc.peak_fit import MODELS, fit_single_peak
from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.peak_model_fit import fit_peak_model
from quantized.calc.peak_multifit import fit_multi_peak
from quantized.calc.peaks import find_peaks_robust
from quantized.routes._errors import CALC_ERRORS, call_calc
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
    peaks, background = call_calc(find_peaks_robust,
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
    except CALC_ERRORS as exc:
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
    result = call_calc(fit_multi_peak,
        req.x, req.y, seeds,
        model=req.model, bg_degree=req.bg_degree,
        constrain=req.constrain, link_mode=req.link_mode,
    )
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
    except CALC_ERRORS as exc:
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
        # A failing spectrum is flagged per row rather than aborting the batch,
        # and the row carries the reason (calc/peak_batch: "region lies outside
        # the data range" and friends) so the user can see WHICH spectrum went
        # wrong and why. Curated ValueError text, not a traceback -- see
        # SECURITY.md.
        # NOTE(codeql py/stack-trace-exposure): reviewed, by design -- SECURITY.md.
        return to_jsonable(  # type: ignore[no-any-return]
            batch_integrate_peaks(
                np.asarray(req.x, dtype=float),
                [np.asarray(s, dtype=float) for s in req.spectra],
                [(float(a), float(b)) for a, b in req.regions],
                baseline=req.baseline, align=req.align,
                reference=req.reference, labels=req.labels,
            )
        )
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ── mixed-shape peak model fit (audit P2.4) ──────────────────────────────────

# Cost caps: one evaluation costs ~points x peaks exp() calls and a TRF step
# ~(n_free + 1) evaluations, so a large fit is bounded by the deadline, which
# returns the best point seen (flagged) rather than running on. The 30 s cap
# matches /api/reflectivity/fit (FIT_DEADLINE_S): synchronous fits share one
# worst-case request time until long fits move onto the job queue.
MODEL_FIT_MAX_POINTS = 100_000
MODEL_FIT_MAX_PEAKS = 50
MODEL_FIT_MAX_PARAMETERS = 4 * MODEL_FIT_MAX_PEAKS + 3
MODEL_FIT_MAX_DEADLINE_S = 30.0

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
PeakShape = Literal["gaussian", "lorentzian", "pseudo_voigt", "voigt"]
# A null (or non-finite) x / y / y_err entry marks a row the fit drops.
Column = list[float | None]
# Parameter names are ASCII (p0.center, bg.c1), so error text echoing one is too.
_PARAM_NAME = r"^[a-z0-9_.]+$"


class PeakModelParameter(BaseModel):
    """``p{i}.{center|height|fwhm|eta|fwhm_g|fwhm_l}`` or ``bg.c{k}``: start
    ``value``, ``vary``, optional bounds and an identity ``tie``."""

    name: str = Field(min_length=1, max_length=32, pattern=_PARAM_NAME)
    value: FiniteFloat
    vary: bool = False
    min: FiniteFloat | None = None
    max: FiniteFloat | None = None
    tie: str | None = Field(default=None, max_length=32, pattern=r"^[a-z0-9_.]*$")


class PeakModelFitRequest(BaseModel):
    x: Column = Field(min_length=2, max_length=MODEL_FIT_MAX_POINTS)
    y: Column = Field(min_length=2, max_length=MODEL_FIT_MAX_POINTS)
    y_err: Column | None = Field(default=None, max_length=MODEL_FIT_MAX_POINTS)
    shapes: list[PeakShape] = Field(min_length=1, max_length=MODEL_FIT_MAX_PEAKS)
    background: Literal["none", "constant", "linear", "quadratic"] = "linear"
    parameters: list[PeakModelParameter] = Field(
        min_length=1, max_length=MODEL_FIT_MAX_PARAMETERS)
    x_min: FiniteFloat | None = None
    x_max: FiniteFloat | None = None
    bg_x_ref: FiniteFloat | None = None
    max_nfev: int = Field(default=1000, ge=1, le=10_000)
    deadline_s: float = Field(default=10.0, gt=0.0, le=MODEL_FIT_MAX_DEADLINE_S)


class PeakModelParameterOut(BaseModel):
    name: str
    value: float | None
    stderr: float | None
    vary: bool
    tie: str | None
    at_bound: bool


class PeakModelPeakOut(BaseModel):
    """Derived per-peak quantities with delta-method standard errors."""

    id: str
    shape: str
    center: float | None
    center_stderr: float | None
    height: float | None
    height_stderr: float | None
    fwhm: float | None
    fwhm_stderr: float | None
    area: float | None
    area_stderr: float | None


class PeakModelBackgroundOut(BaseModel):
    kind: str
    x_ref: float


class PeakModelMetrics(BaseModel):
    """``chi2``/``reduced_chi2`` only for a weighted fit; ``ssr`` always."""

    objective: Literal["ssr", "chi2"]
    n_points: int
    n_free: int
    dof: int
    ssr: float | None
    reduced_ssr: float | None
    chi2: float | None
    reduced_chi2: float | None
    r_squared: float | None
    adj_r_squared: float | None
    aic: float | None
    bic: float | None


class PeakModelCurves(BaseModel):
    """On the fitted points; ``components`` are the peaks without background."""

    x: Column
    y: Column
    y_err: Column | None
    model: Column
    background: Column
    components: list[Column]
    residual: Column
    normalized_residual: Column | None


class PeakModelFitResponse(BaseModel):
    parameters: list[PeakModelParameterOut]
    free: list[str]
    correlation: list[list[float | None]]
    peaks: list[PeakModelPeakOut]
    background: PeakModelBackgroundOut
    weighted: bool
    metrics: PeakModelMetrics
    success: bool
    message: str
    n_evaluations: int
    x_range: list[float]
    n_dropped: int
    n_excluded: int
    curves: PeakModelCurves
    warnings: list[str]


def _column(values: Column | None) -> list[float] | None:
    if values is None:
        return None
    return [float("nan") if v is None else v for v in values]


@router.post("/model-fit", response_model=PeakModelFitResponse)
def model_fit(req: PeakModelFitRequest) -> dict[str, Any]:
    """Fit mixed-shape peaks + a polynomial background with per-parameter
    start/vary/bounds/ties; returns parameters, derived peaks, metrics,
    curves and warnings."""
    out = call_calc(fit_peak_model,
        _column(req.x), _column(req.y), list(req.shapes),
        [p.model_dump() for p in req.parameters],
        background=req.background, y_err=_column(req.y_err),
        x_min=req.x_min, x_max=req.x_max, bg_x_ref=req.bg_x_ref,
        max_nfev=req.max_nfev, deadline_s=req.deadline_s,
    )
    result: dict[str, Any] = to_jsonable(out)
    return result
