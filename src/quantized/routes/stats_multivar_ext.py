"""Thin routes for PLS, LDA and spectra-as-observations PCA (GAP_AUDIT_9 G12).

Wraps ``calc.stats_pls``, ``calc.stats_lda`` and ``calc.stats_spectra``.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.stats_lda import lda_analysis
from quantized.calc.stats_pls import pls_analysis
from quantized.calc.stats_spectra import pca_spectra
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


class PlsRequest(BaseModel):
    x: list[list[float]]
    y: list[list[float]]
    n_components: int | None = Field(default=None, ge=1)
    max_components: int = Field(default=10, ge=1, le=50)
    folds: int = Field(default=7, ge=2)
    seed: int = 0
    preprocess: Literal["none", "center", "autoscale"] = "center"


class LdaRequest(BaseModel):
    x: list[list[float]]
    labels: list[str | float]
    priors: Literal["empirical", "equal"] = "empirical"
    cv_folds: int = Field(default=0, ge=0)
    seed: int = 0


class SpectraPcaRequest(BaseModel):
    spectra_x: list[list[float]]
    spectra_y: list[list[float]]
    center: bool = True
    scale: bool = False
    num_components: int = Field(default=0, ge=0)
    resample: bool = False


@router.post("/pls")
def pls(req: PlsRequest) -> dict[str, Any]:
    """PLS1/PLS2 with k-fold CV, VIP, R2Y and Q2."""
    return to_jsonable(  # type: ignore[no-any-return]
        call_calc(
            lambda: pls_analysis(
                np.asarray(req.x, dtype=float),
                np.asarray(req.y, dtype=float),
                n_components=req.n_components,
                max_comp=req.max_components,
                folds=req.folds,
                seed=req.seed,
                preprocess=req.preprocess,
            )
        )
    )


@router.post("/lda")
def lda(req: LdaRequest) -> dict[str, Any]:
    """Linear discriminant analysis with optional stratified k-fold CV."""
    return to_jsonable(  # type: ignore[no-any-return]
        call_calc(
            lambda: lda_analysis(
                np.asarray(req.x, dtype=float),
                req.labels,
                priors=req.priors,
                cv_folds=req.cv_folds,
                seed=req.seed,
            )
        )
    )


@router.post("/pca-spectra")
def pca_spectra_route(req: SpectraPcaRequest) -> dict[str, Any]:
    """PCA with each spectrum as one observation (common grid enforced)."""
    return to_jsonable(  # type: ignore[no-any-return]
        call_calc(
            lambda: pca_spectra(
                req.spectra_x,
                req.spectra_y,
                center=req.center,
                scale=req.scale,
                num_components=req.num_components,
                resample=req.resample,
            )
        )
    )
