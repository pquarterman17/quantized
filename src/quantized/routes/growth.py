"""Thin growth-mode / equilibrium-shape routes. Wraps ``calc.growth_mode``
(Bauer criterion) and, later, ``calc.wulff``. Validate -> call -> serialize.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.growth_mode import bauer_scan
from quantized.routes._errors import call_calc

router = APIRouter(prefix="/api/growth", tags=["growth"])


class BauerRequest(BaseModel):
    """All energies in ONE user-chosen unit; none is looked up."""

    gamma_substrate: float
    gamma_film: float
    gamma_int_min: float
    gamma_int_max: float
    n: int = Field(default=11, ge=2, le=2000)
    uncertainty: float = 0.0
    strain_penalty: float = 0.0


@router.post("/bauer")
def bauer(req: BauerRequest) -> dict[str, Any]:
    """Growth-mode verdict across a gamma_int range (Bauer inequality)."""
    return call_calc(
        bauer_scan,
        req.gamma_substrate,
        req.gamma_film,
        req.gamma_int_min,
        req.gamma_int_max,
        req.n,
        uncertainty=req.uncertainty,
        strain_penalty=req.strain_penalty,
    )
