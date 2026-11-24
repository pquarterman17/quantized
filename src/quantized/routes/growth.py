"""Thin growth-mode / equilibrium-shape routes. Wraps ``calc.growth_mode``
(Bauer criterion) and ``calc.wulff`` (Wulff shape + cross-section). Validate -> call -> serialize.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.growth_mode import bauer_scan
from quantized.calc.wulff import wulff_section, wulff_shape
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


class WulffFacet(BaseModel):
    hkl: tuple[int, int, int]
    gamma: float  # surface energy of this family, caller-supplied


class WulffRequest(BaseModel):
    facets: list[WulffFacet] = Field(min_length=1, max_length=64)
    cell: tuple[float, float, float, float, float, float] = (1.0, 1.0, 1.0, 90.0, 90.0, 90.0)
    symmetry: Literal["cubic", "inversion", "none"] = "cubic"
    section_hkl: tuple[int, int, int] | None = None  # also return this central section


@router.post("/wulff")
def wulff(req: WulffRequest) -> dict[str, Any]:
    """Wulff polyhedron (vertices, facets, area fractions) and optional section."""
    facets = [(f.hkl, f.gamma) for f in req.facets]

    def run() -> dict[str, Any]:
        shape = wulff_shape(facets, req.cell, req.symmetry)
        if req.section_hkl is not None:
            shape["section"] = wulff_section(facets, req.section_hkl, req.cell, req.symmetry)
        return shape

    return call_calc(run)
