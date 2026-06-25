"""Thin RSM route: substrate/film reciprocal-space peaks -> strain + relaxation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.rsm import rsm_strain
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
