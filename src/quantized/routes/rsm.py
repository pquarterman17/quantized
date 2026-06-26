"""Thin RSM route: substrate/film reciprocal-space peaks -> strain + relaxation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.rsm import rsm_strain
from quantized.calc.rsm_analyze import rsm_analyze, rsm_grids_from_datastruct
from quantized.datastruct import DataStruct
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/rsm", tags=["rsm"])


class StrainRequest(BaseModel):
    """Reciprocal-space peak centres ``(Qx, Qz)`` in Ang^-1."""

    q_sub: tuple[float, float]
    q_film: tuple[float, float]
    bulk: tuple[float, float] | None = None


@router.post("/strain")
def strain(req: StrainRequest) -> dict[str, Any]:
    """In-plane / out-of-plane strain + relaxation from an RSM peak pair."""
    try:
        result = rsm_strain(req.q_sub, req.q_film, bulk=req.bulk)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # NaN (symmetric reflection / no bulk) -> null for valid wire JSON.
    return to_jsonable(result)  # type: ignore[no-any-return]


class AnalyzeRequest(BaseModel):
    """A scattered 2D RSM dataset (from the XRDML 2D parser) + detection options."""

    dataset: dict[str, Any]
    n_peaks: int = Field(default=2, ge=1, le=20)
    threshold: float = Field(default=0.01, ge=0.0)
    smooth_sigma: float = Field(default=1.5, gt=0.0)
    min_separation: int = Field(default=4, ge=1)
    fit_window: int = Field(default=6, ge=1)
    fit_model: str = "2D Gaussian"


@router.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    """Extract + fit peaks from a 2D RSM dataset (centres/FWHM in angle + Q-space)."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        grids = rsm_grids_from_datastruct(ds)
        result = rsm_analyze(
            grids["intensity"],
            grids["axis1"],
            grids["axis2"],
            qx=grids["qx"],
            qz=grids["qz"],
            n_peaks=req.n_peaks,
            threshold=req.threshold,
            smooth_sigma=req.smooth_sigma,
            min_separation=req.min_separation,
            fit_window=req.fit_window,
            fit_model=req.fit_model,
            intensity_unit=grids["intensity_unit"],
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return to_jsonable(result)  # type: ignore[no-any-return]
