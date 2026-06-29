"""Thin-film calculator routes. Wraps ``calc.thin_film`` (pure formulas):
deposition / sputter rate, diffusion length, implant dose + peak concentration,
Kiessig thickness, multilayer thermal conductivity, projected range, Stoney
stress, thermal-mismatch strain. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import thin_film

router = APIRouter(prefix="/api/thin-film", tags=["thin-film"])


class DepositionRateRequest(BaseModel):
    thickness: float  # Å
    time: float  # s


class DiffusionLengthRequest(BaseModel):
    d: float  # cm^2/s
    t: float  # s


class DoseFromCurrentRequest(BaseModel):
    current: float  # A
    time: float  # s
    area: float  # cm^2


class DoseToConcentrationRequest(BaseModel):
    dose: float  # ions/cm^2
    rp: float  # nm
    delta_rp: float  # nm


class KiessigRequest(BaseModel):
    delta_q: float  # Å^-1
    sld: float | None = None  # Å^-2
    qc: float | None = None  # Å^-1


class MultilayerThermalRequest(BaseModel):
    thicknesses: list[float]  # nm
    kappas: list[float]  # W/m/K


class ProjectedRangeRequest(BaseModel):
    ion: str
    target: str
    energy: float  # keV


class SputterRateRequest(BaseModel):
    y: float  # atoms/ion
    j: float  # mA/cm^2
    rho: float  # g/cm^3
    m: float  # g/mol


class StoneyStressRequest(BaseModel):
    es: float  # Pa
    nus: float
    ts: float  # m
    tf: float  # m
    r: float  # m


class ThermalMismatchRequest(BaseModel):
    alpha_film: float  # 1/K
    alpha_sub: float  # 1/K
    delta_t: float  # K
    e: float | None = None  # Pa
    nu: float = 0.3


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/deposition-rate")
def deposition_rate(req: DepositionRateRequest) -> dict[str, Any]:
    """r = thickness/time (Å/s, nm/min)."""
    return _call(thin_film.deposition_rate, req.thickness, req.time)


@router.post("/diffusion-length")
def diffusion_length(req: DiffusionLengthRequest) -> dict[str, Any]:
    """L = √(D·t) (cm/nm/µm)."""
    return _call(thin_film.diffusion_length_thermal, req.d, req.t)


@router.post("/dose-from-current")
def dose_from_current(req: DoseFromCurrentRequest) -> dict[str, Any]:
    """Φ = I·t/(q·A) (ions/cm²)."""
    return _call(thin_film.dose_from_current, req.current, req.time, req.area)


@router.post("/dose-to-concentration")
def dose_to_concentration(req: DoseToConcentrationRequest) -> dict[str, Any]:
    """C_peak = dose/(√(2π)·ΔRp) (atoms/cm³)."""
    return _call(thin_film.dose_to_concentration, req.dose, req.rp, req.delta_rp)


@router.post("/kiessig-thickness")
def kiessig_thickness(req: KiessigRequest) -> dict[str, Any]:
    """t = 2π/ΔQ (refraction-corrected when SLD/Qc supplied)."""
    return _call(thin_film.kiessig_thickness, req.delta_q, sld=req.sld, qc=req.qc)


@router.post("/multilayer-thermal")
def multilayer_thermal(req: MultilayerThermalRequest) -> dict[str, Any]:
    """Series / parallel effective thermal conductivity (W/m/K)."""
    return _call(thin_film.multilayer_thermal_conductivity, req.thicknesses, req.kappas)


@router.post("/projected-range")
def projected_range(req: ProjectedRangeRequest) -> dict[str, Any]:
    """LSS projected range Rp + straggle ΔRp (nm)."""
    return _call(thin_film.projected_range, req.ion, req.target, req.energy)


@router.post("/sputter-rate")
def sputter_rate(req: SputterRateRequest) -> dict[str, Any]:
    """Sputter erosion rate (nm/s, nm/min)."""
    return _call(thin_film.sputter_rate, req.y, req.j, req.rho, req.m)


@router.post("/stoney-stress")
def stoney_stress(req: StoneyStressRequest) -> dict[str, Any]:
    """σ = E_s·t_s²/(6(1−ν_s)·t_f·R) (Pa)."""
    return _call(thin_film.stoney_stress, req.es, req.nus, req.ts, req.tf, req.r)


@router.post("/thermal-mismatch")
def thermal_mismatch(req: ThermalMismatchRequest) -> dict[str, Any]:
    """ε = (α_f−α_s)·ΔT, σ = E·ε/(1−ν) (MPa)."""
    return _call(
        thin_film.thermal_mismatch_strain,
        req.alpha_film,
        req.alpha_sub,
        req.delta_t,
        e=req.e,
        nu=req.nu,
    )
