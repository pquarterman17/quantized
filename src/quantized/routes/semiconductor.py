"""Thin semiconductor device-physics routes. Wraps ``calc.semiconductor`` (pure
formulas): intrinsic carrier concentration / carrier concentrations / depletion
width / diffusion coefficient + length / Fermi level / Debye length / built-in
potential / sheet carrier density / thermal velocity / Hall coefficient /
mobility model. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import semiconductor

router = APIRouter(prefix="/api/semiconductor", tags=["semiconductor"])


class IntrinsicRequest(BaseModel):
    eg: float | None = None
    me_star: float | None = None
    mh_star: float | None = None
    t: float = 300.0
    material: str | None = None


class CarrierConcRequest(BaseModel):
    nd: float
    na: float
    ni: float


class BuiltInPotentialRequest(BaseModel):
    na: float
    nd: float
    ni: float
    t: float = 300.0


class DepletionWidthRequest(BaseModel):
    vbi: float
    na: float
    nd: float
    epsilon_r: float | None = None
    material: str | None = None
    t: float = 300.0


class DiffusionCoeffRequest(BaseModel):
    mu: float
    t: float = 300.0


class DiffusionLengthRequest(BaseModel):
    d: float
    tau: float


class FermiLevelRequest(BaseModel):
    eg: float | None = None
    me_star: float | None = None
    mh_star: float | None = None
    nd: float = 0.0
    na: float = 0.0
    t: float = 300.0
    material: str | None = None


class DebyeLengthRequest(BaseModel):
    n: float
    epsilon_r: float | None = None
    t: float = 300.0
    material: str | None = None


class SheetCarrierRequest(BaseModel):
    n: float
    t: float


class ThermalVelocityRequest(BaseModel):
    m_star: float
    t: float = 300.0


class HallCoefficientRequest(BaseModel):
    n: float
    p: float
    mu_e: float
    mu_h: float


class MobilityModelRequest(BaseModel):
    material: str = "Si"
    t: float = 300.0
    n: float = 0.0


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/materials")
def materials() -> dict[str, Any]:
    """Material-parameter presets (Eg, εᵣ, mₑ*, m_h*)."""
    return {"materials": semiconductor.material_presets()}


@router.post("/intrinsic")
def intrinsic(req: IntrinsicRequest) -> dict[str, Any]:
    """n_i = √(N_c N_v)·exp(−E_g/2k_BT) (cm⁻³)."""
    return _call(
        semiconductor.intrinsic_carrier_conc,
        req.eg,
        req.me_star,
        req.mh_star,
        req.t,
        req.material,
    )


@router.post("/carrier-concentration")
def carrier_concentration(req: CarrierConcRequest) -> dict[str, Any]:
    """n, p from charge-neutrality + mass-action; doping type."""
    return _call(semiconductor.carrier_concentration, req.nd, req.na, req.ni)


@router.post("/built-in-potential")
def built_in_potential(req: BuiltInPotentialRequest) -> dict[str, Any]:
    """V_bi = (k_BT/q)·ln(N_a N_d / n_i²) (V)."""
    return _call(semiconductor.built_in_potential, req.na, req.nd, req.ni, req.t)


@router.post("/depletion-width")
def depletion_width(req: DepletionWidthRequest) -> dict[str, Any]:
    """Depletion width W, x_n, x_p (nm)."""
    return _call(
        semiconductor.depletion_width,
        req.vbi,
        req.na,
        req.nd,
        req.epsilon_r,
        req.material,
        req.t,
    )


@router.post("/diffusion-coeff")
def diffusion_coeff(req: DiffusionCoeffRequest) -> dict[str, Any]:
    """D = μ·k_BT/q (cm²/s)."""
    return _call(semiconductor.diffusion_coeff, req.mu, req.t)


@router.post("/diffusion-length")
def diffusion_length(req: DiffusionLengthRequest) -> dict[str, Any]:
    """L = √(D·τ) (cm / µm)."""
    return _call(semiconductor.diffusion_length, req.d, req.tau)


@router.post("/fermi-level")
def fermi_level(req: FermiLevelRequest) -> dict[str, Any]:
    """E_F − E_i = k_BT·asinh(Δ/2n_i) (eV)."""
    return _call(
        semiconductor.fermi_level,
        req.eg,
        req.me_star,
        req.mh_star,
        req.nd,
        req.na,
        req.t,
        req.material,
    )


@router.post("/debye-length")
def debye_length(req: DebyeLengthRequest) -> dict[str, Any]:
    """L_D = √(ε₀εᵣk_BT/(q²n)) (nm)."""
    return _call(semiconductor.debye_length, req.n, req.epsilon_r, req.t, req.material)


@router.post("/sheet-carrier-density")
def sheet_carrier_density(req: SheetCarrierRequest) -> dict[str, Any]:
    """n_s = n·t (cm⁻²)."""
    return _call(semiconductor.sheet_carrier_density, req.n, req.t)


@router.post("/thermal-velocity")
def thermal_velocity(req: ThermalVelocityRequest) -> dict[str, Any]:
    """v_th = √(3k_BT/(m* m₀)) (cm/s)."""
    return _call(semiconductor.thermal_velocity, req.m_star, req.t)


@router.post("/hall-coefficient")
def hall_coefficient(req: HallCoefficientRequest) -> dict[str, Any]:
    """R_H = (1/q)(pμ_h² − nμ_e²)/(pμ_h + nμ_e)² (cm³/C)."""
    return _call(semiconductor.hall_coefficient, req.n, req.p, req.mu_e, req.mu_h)


@router.post("/mobility-model")
def mobility_model(req: MobilityModelRequest) -> dict[str, Any]:
    """Caughey-Thomas μ_e, μ_h (cm²/V·s)."""
    return _call(semiconductor.mobility_model, req.material, req.t, req.n)
