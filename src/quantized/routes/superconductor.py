"""Thin superconductivity routes. Wraps ``calc.superconductor`` (pure formulas):
material presets / London depth / coherence length / GL parameter / critical
fields / depairing current / BCS gap. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import superconductor

router = APIRouter(prefix="/api/superconductor", tags=["superconductor"])


class LondonRequest(BaseModel):
    lambda0: float | None = None
    t: float
    tc: float | None = None
    material: str | None = None


class CoherenceRequest(BaseModel):
    xi0: float | None = None
    t: float
    tc: float | None = None
    material: str | None = None


class GlRequest(BaseModel):
    lambda_: float | None = None
    xi: float | None = None
    material: str | None = None
    t: float | None = None


class CriticalFieldsRequest(BaseModel):
    hc0: float | None = None
    tc: float | None = None
    t: float
    material: str | None = None
    lambda_: float | None = None
    xi: float | None = None
    kappa: float | None = None


class DepairingRequest(BaseModel):
    hc0: float | None = None
    lambda0: float | None = None
    tc: float | None = None
    t: float
    material: str | None = None


class BcsGapRequest(BaseModel):
    tc: float
    t: float | None = None


class PresetsRequest(BaseModel):
    material: str | None = None


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/material-presets")
def material_presets(req: PresetsRequest) -> dict[str, Any]:
    """Material property table (all, or a single named material)."""
    return _call(superconductor.material_presets, req.material)


@router.post("/london-depth")
def london_depth(req: LondonRequest) -> dict[str, Any]:
    """λ(T) = λ₀/√(1 − (T/Tc)⁴) (nm)."""
    return _call(
        superconductor.london_depth, req.lambda0, req.t, req.tc, material=req.material
    )


@router.post("/coherence-length")
def coherence_length(req: CoherenceRequest) -> dict[str, Any]:
    """ξ(T) = ξ₀/√(1 − (T/Tc)²) (nm)."""
    return _call(
        superconductor.coherence_length, req.xi0, req.t, req.tc, material=req.material
    )


@router.post("/gl-parameter")
def gl_parameter(req: GlRequest) -> dict[str, Any]:
    """κ = λ/ξ; type I/II classification."""
    return _call(
        superconductor.gl_parameter,
        req.lambda_,
        req.xi,
        material=req.material,
        t=req.t,
    )


@router.post("/critical-fields")
def critical_fields(req: CriticalFieldsRequest) -> dict[str, Any]:
    """Hc, Hc1, Hc2 (Oe) and superconductor type."""
    return _call(
        superconductor.critical_fields,
        req.hc0,
        req.tc,
        req.t,
        material=req.material,
        lambda_=req.lambda_,
        xi=req.xi,
        kappa=req.kappa,
    )


@router.post("/depairing-current")
def depairing_current(req: DepairingRequest) -> dict[str, Any]:
    """Jd = Hc(T)/(3√6·π·λ(T)) (A/cm² and MA/cm²)."""
    return _call(
        superconductor.depairing_current,
        req.hc0,
        req.lambda0,
        req.tc,
        req.t,
        material=req.material,
    )


@router.post("/bcs-gap")
def bcs_gap(req: BcsGapRequest) -> dict[str, Any]:
    """Δ₀ = 1.764·k_B·Tc (meV); Mühlschlegel Δ(T) when T given."""
    return _call(superconductor.bcs_gap, req.tc, req.t)
