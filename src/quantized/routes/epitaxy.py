"""Thin epitaxy routes. Wraps ``calc.surface_net`` and ``calc.coincidence``
(pure numpy): the reduced in-plane lattice of a plane, the mismatch between a
film net and a substrate net, and the coincidence-lattice (supercell) search
(THIN_FILM_STACK_PLANNING_PLAN G1). Validate -> call calc -> serialize.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc.coincidence import coincidence_search
from quantized.calc.surface_net import net_mismatch, surface_net
from quantized.routes._errors import call_calc

router = APIRouter(prefix="/api/epitaxy", tags=["epitaxy"])

Centering = Literal["P", "F", "I", "A", "B", "C", "R"]


class PlaneRequest(BaseModel):
    a: float
    b: float | None = None  # None -> a
    c: float | None = None  # None -> a
    alpha: float = 90.0
    beta: float = 90.0
    gamma: float = 90.0
    centering: Centering = "P"
    hkl: list[int] = Field(min_length=3, max_length=4)  # (h k l) or (h k i l)


def _net(req: PlaneRequest) -> dict[str, Any]:
    return call_calc(
        surface_net,
        req.a,
        req.hkl,
        b=req.b,
        c=req.c,
        alpha=req.alpha,
        beta=req.beta,
        gamma=req.gamma,
        centering=req.centering,
    )


@router.post("/surface-net")
def plane_net(req: PlaneRequest) -> dict[str, Any]:
    """Reduced 2D lattice (u, v, gamma, area) of the plane (hkl)."""
    return _net(req)


class NetMismatchRequest(BaseModel):
    film: PlaneRequest
    substrate: PlaneRequest


@router.post("/net-mismatch")
def plane_net_mismatch(req: NetMismatchRequest) -> dict[str, Any]:
    """Film-on-substrate mismatch with the two reduced nets aligned."""
    return call_calc(net_mismatch, _net(req.film), _net(req.substrate))


class CoincidenceRequest(BaseModel):
    film: PlaneRequest
    substrate: PlaneRequest
    max_strain: float = Field(default=0.05, gt=0, le=0.5)  # fraction
    max_angle: float = Field(default=1.0, ge=0, le=10)  # degrees
    max_area: float = Field(default=200.0, gt=0, le=2000)  # Å²
    max_results: int = Field(default=10, ge=1, le=100)


@router.post("/coincidence")
def coincidence(req: CoincidenceRequest) -> dict[str, Any]:
    """Coincidence-lattice (supercell) matches of a film plane on a substrate plane."""
    return call_calc(
        coincidence_search,
        req.film.model_dump(exclude_none=True),
        req.substrate.model_dump(exclude_none=True),
        max_strain=req.max_strain,
        max_angle=req.max_angle,
        max_area=req.max_area,
        max_results=req.max_results,
    )
