"""Thin composition routes. Wraps ``calc.composition`` (pure formulas):
weight% <-> atomic% conversion and co-deposition source flux ratios (the
DiraCulator X-ray/Neutron tab's Cards 5-6). Validate -> call calc -> serialize.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.composition import (
    atomic_to_weight_percent,
    co_deposition_ratio,
    weight_to_atomic_percent,
)
from quantized.routes._errors import call_calc

router = APIRouter(prefix="/api/composition", tags=["composition"])

# A composition or source list is a handful of entries; the caps only stop an
# accidental paste from turning into an unbounded request.
_MAX_ENTRIES = 32


class PercentRequest(BaseModel):
    elements: list[str] = Field(max_length=_MAX_ENTRIES)
    values: list[float] = Field(max_length=_MAX_ENTRIES)  # %, normalised server-side


@router.post("/atomic-to-weight")
def atomic_to_weight(req: PercentRequest) -> dict[str, Any]:
    """Atomic percent -> weight percent (inputs normalised to 100 first)."""
    return call_calc(atomic_to_weight_percent, req.elements, req.values)


@router.post("/weight-to-atomic")
def weight_to_atomic(req: PercentRequest) -> dict[str, Any]:
    """Weight percent -> atomic percent (inputs normalised to 100 first)."""
    return call_calc(weight_to_atomic_percent, req.elements, req.values)


class CoDepositionRequest(BaseModel):
    formula: str = Field(max_length=200)
    sources: list[str] = Field(max_length=_MAX_ENTRIES)


@router.post("/co-deposition")
def co_deposition(req: CoDepositionRequest) -> dict[str, Any]:
    """Relative source fluxes (smallest = 1) to co-deposit the target formula."""
    return call_calc(co_deposition_ratio, req.formula, req.sources)
