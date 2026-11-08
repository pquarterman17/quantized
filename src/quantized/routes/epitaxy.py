"""Thin epitaxy routes. Wraps ``calc.surface_net`` (pure numpy): the reduced
in-plane lattice of a plane, and the mismatch between a film net and a
substrate net (THIN_FILM_STACK_PLANNING_PLAN G1). Validate -> call calc ->
serialize.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

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
