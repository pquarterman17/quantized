"""Thin magnetic-calculator routes. Wraps ``calc.magnetic`` (pure formulas):
moment conversion / magnetization / demagnetizing factors / Curie-Weiss /
Langevin / domain wall. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import magnetic

router = APIRouter(prefix="/api/magnetic", tags=["magnetic"])


class MomentConvertRequest(BaseModel):
    value: float
    unit: str = "emu"
    volume: float | None = None
    atoms: float | None = None


class BohrMagnetonRequest(BaseModel):
    moment: float
    unit: str = "emu"


class MagnetizationRequest(BaseModel):
    moment: float
    volume: float


class MomentPerAtomRequest(BaseModel):
    total_moment: float
    volume: float
    atom_density: float


class DemagRequest(BaseModel):
    shape: str  # GUI dropdown label (e.g. "Sphere", "Thin film (in-plane)")


class CurieWeissRequest(BaseModel):
    C: float
    theta: float


class CurieWeissFitRequest(BaseModel):
    temperature: list[float]
    susceptibility: list[float]
    fit_range: tuple[float, float] | None = None


class LangevinRequest(BaseModel):
    mu: float
    field_oe: float
    temperature: float


class DomainWallRequest(BaseModel):
    exchange_a: float
    anisotropy_k: float


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/moment-convert")
def moment_convert(req: MomentConvertRequest) -> dict[str, Any]:
    """Convert a moment to emu / A·m² / µ_B (+ magnetization, µ_B/atom)."""
    return _call(
        magnetic.moment_convert, req.value, req.unit, volume=req.volume, atoms=req.atoms
    )


@router.post("/bohr-magneton")
def bohr_magneton(req: BohrMagnetonRequest) -> dict[str, Any]:
    """Moment → number of Bohr magnetons."""
    return _call(magnetic.bohr_magneton_convert, req.moment, req.unit)


@router.post("/magnetization")
def magnetization(req: MagnetizationRequest) -> dict[str, Any]:
    """M = m/V (emu/cm³, A/m, kA/m)."""
    return _call(magnetic.magnetization, req.moment, req.volume)


@router.post("/moment-per-atom")
def moment_per_atom(req: MomentPerAtomRequest) -> dict[str, Any]:
    """Per-atom moment in Bohr magnetons."""
    return _call(
        magnetic.moment_per_atom, req.total_moment, req.volume, req.atom_density
    )


@router.post("/demag")
def demag(req: DemagRequest) -> dict[str, Any]:
    """Demagnetizing factors Nz, Nxy, 4πNz from a geometry label."""
    return _call(magnetic.demag_named, req.shape)


@router.post("/curie-weiss")
def curie_weiss(req: CurieWeissRequest) -> dict[str, Any]:
    """µ_eff and order type from Curie constant C and Weiss temperature θ."""
    return _call(magnetic.curie_weiss_moment, req.C, req.theta)


@router.post("/curie-weiss-fit")
def curie_weiss_fit(req: CurieWeissFitRequest) -> dict[str, Any]:
    """Curie-Weiss fit of 1/χ vs T → θ_CW, C, µ_eff, R²."""
    return _call(
        magnetic.curie_weiss_fit,
        req.temperature,
        req.susceptibility,
        fit_range=req.fit_range,
    )


@router.post("/langevin")
def langevin(req: LangevinRequest) -> dict[str, Any]:
    """Langevin L(x) = coth(x) − 1/x for a superparamagnet."""
    return _call(magnetic.langevin, req.mu, req.field_oe, req.temperature)


@router.post("/domain-wall")
def domain_wall(req: DomainWallRequest) -> dict[str, Any]:
    """Domain-wall width δ = π√(A/K) and energy E = 4√(AK)."""
    return _call(magnetic.domain_wall, req.exchange_a, req.anisotropy_k)
