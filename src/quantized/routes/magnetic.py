"""Thin magnetic-calculator routes. Wraps ``calc.magnetic`` (pure formulas):
moment conversion / magnetization / demagnetizing factors / Curie-Weiss /
Langevin / domain wall. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from quantized.calc import magnetic
from quantized.calc.magnetic_curie_weiss_data import curie_weiss_data_fit
from quantized.routes._errors import call_calc as _call
from quantized.routes._payload import to_jsonable

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


class DemagCustomRequest(BaseModel):
    """A geometry by its dimensions: a cylinder's length and diameter (same
    unit), or a spheroid's axis ratio (prolate c/a, oblate a/c, both > 1)."""

    shape: Literal["cylinder", "prolate", "oblate"]
    length: float = Field(default=1.0, allow_inf_nan=False)
    diameter: float = Field(default=1.0, allow_inf_nan=False)
    ratio: float = Field(default=2.0, allow_inf_nan=False)


class CurieWeissRequest(BaseModel):
    C: float
    theta: float


class CurieWeissFitRequest(BaseModel):
    temperature: list[float]
    susceptibility: list[float]
    fit_range: tuple[float, float] | None = None


class CurieWeissDataFitRequest(BaseModel):
    temperature: list[float]
    response: list[float]
    response_basis: Literal["molar_susceptibility", "total_moment", "mass_moment"]
    fit_range: tuple[float, float]
    field: list[float] | None = None
    field_unit: str = "Oe"
    sample_mass_g: float | None = Field(default=None, allow_inf_nan=False)
    molar_mass_g_mol: float | None = Field(default=None, allow_inf_nan=False)
    response_errors: list[list[float]] = Field(default_factory=list)


class LangevinRequest(BaseModel):
    mu: float
    field_oe: float
    temperature: float


class DomainWallRequest(BaseModel):
    exchange_a: float
    anisotropy_k: float


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


@router.post("/demag-custom")
def demag_custom(req: DemagCustomRequest) -> dict[str, Any]:
    """Demagnetizing factors Nz, Nxy, 4πNz for a custom cylinder or spheroid."""
    return _call(
        magnetic.demag_factor, req.shape, length=req.length, diameter=req.diameter, ratio=req.ratio
    )


@router.post("/curie-weiss")
def curie_weiss(req: CurieWeissRequest) -> dict[str, Any]:
    """µ_eff and order type from Curie constant C and Weiss temperature θ."""
    return _call(magnetic.curie_weiss_moment, req.C, req.theta)


@router.post("/curie-weiss-fit")
def curie_weiss_fit(req: CurieWeissFitRequest) -> dict[str, Any]:
    """Curie-Weiss fit of 1/χ vs T → θ_CW, C, µ_eff, R²."""
    result = _call(
        magnetic.curie_weiss_fit,
        req.temperature,
        req.susceptibility,
        fit_range=req.fit_range,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/curie-weiss-data-fit")
def curie_weiss_loaded_data(req: CurieWeissDataFitRequest) -> dict[str, Any]:
    """Fit loaded M(T) or molar-chi(T) data with explicit sample context."""
    result = _call(
        curie_weiss_data_fit,
        req.temperature,
        req.response,
        response_basis=req.response_basis,
        fit_range=req.fit_range,
        field=req.field,
        field_unit=req.field_unit,
        sample_mass_g=req.sample_mass_g,
        molar_mass_g_mol=req.molar_mass_g_mol,
        response_errors=req.response_errors,
    )
    return to_jsonable(result)  # type: ignore[no-any-return]


@router.post("/langevin")
def langevin(req: LangevinRequest) -> dict[str, Any]:
    """Langevin L(x) = coth(x) − 1/x for a superparamagnet."""
    return _call(magnetic.langevin, req.mu, req.field_oe, req.temperature)


@router.post("/domain-wall")
def domain_wall(req: DomainWallRequest) -> dict[str, Any]:
    """Domain-wall width δ = π√(A/K) and energy E = 4√(AK)."""
    return _call(magnetic.domain_wall, req.exchange_a, req.anisotropy_k)
