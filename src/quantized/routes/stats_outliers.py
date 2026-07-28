"""Thin outlier-screening routes (JMP_GAP_PLAN J9). Wraps ``calc.stats_outliers``.

Same ``/api/stats`` prefix as ``routes/stats.py``; split into its own module
per the 500-line god-module ceiling (mirrors ``routes/stats_design.py``).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_outliers import dixon_q_test, grubbs_test, mad_outliers, rosner_test
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


class GrubbsRequest(BaseModel):
    x: list[float]
    alpha: float = 0.05
    tail: str = "two-sided"


class RosnerRequest(BaseModel):
    x: list[float]
    k: int
    alpha: float = 0.05


class DixonQRequest(BaseModel):
    x: list[float]
    alpha: float = 0.05


class MadOutliersRequest(BaseModel):
    x: list[float]
    threshold: float = 3.5


@router.post("/grubbs")
def grubbs_route(req: GrubbsRequest) -> dict[str, Any]:
    """Grubbs' test for a single outlier."""
    try:
        return _wrap(
            grubbs_test(np.asarray(req.x, dtype=float), alpha=req.alpha, tail=req.tail)
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/rosner")
def rosner_route(req: RosnerRequest) -> dict[str, Any]:
    """Generalized ESD test (Rosner) for up to k outliers."""
    try:
        return _wrap(rosner_test(np.asarray(req.x, dtype=float), req.k, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/dixon-q")
def dixon_q_route(req: DixonQRequest) -> dict[str, Any]:
    """Dixon's Q test for a single outlier in a small sample (3 <= n <= 30)."""
    try:
        return _wrap(dixon_q_test(np.asarray(req.x, dtype=float), alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/mad-outliers")
def mad_outliers_route(req: MadOutliersRequest) -> dict[str, Any]:
    """Robust modified z-score (MAD-based) outlier flagging."""
    try:
        return _wrap(mad_outliers(np.asarray(req.x, dtype=float), threshold=req.threshold))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
