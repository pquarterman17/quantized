"""Thin vacuum-science routes. Wraps ``calc.vacuum`` (pure formulas): mean free
path / monolayer time / sputter yield / pump-down time / Knudsen number / gas
flow conductance. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import vacuum

router = APIRouter(prefix="/api/vacuum", tags=["vacuum"])


class MeanFreePathRequest(BaseModel):
    p: float
    temperature: float = 300.0
    d: float = 3.64e-10


class MonolayerTimeRequest(BaseModel):
    p: float
    m: float = 4.65e-26
    temperature: float = 300.0
    a_site: float = 1e-19


class KnudsenRequest(BaseModel):
    mfp: float
    length: float


class PumpDownRequest(BaseModel):
    v: float
    s: float
    p0: float
    pf: float


class SputterYieldRequest(BaseModel):
    material: str
    energy: float
    ion: str = "Ar"


class GasFlowRequest(BaseModel):
    p1: float
    p2: float
    d: float
    length: float
    temperature: float = 300.0
    m: float = 4.65e-26


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/mean-free-path")
def mean_free_path(req: MeanFreePathRequest) -> dict[str, Any]:
    """λ = k_B·T / (√2·π·d²·P) (m)."""
    return _call(vacuum.mean_free_path, req.p, temperature=req.temperature, d=req.d)


@router.post("/monolayer-time")
def monolayer_time(req: MonolayerTimeRequest) -> dict[str, Any]:
    """t_mono = 1/(J·A_site) (s)."""
    return _call(
        vacuum.monolayer_time,
        req.p,
        m=req.m,
        temperature=req.temperature,
        a_site=req.a_site,
    )


@router.post("/knudsen")
def knudsen(req: KnudsenRequest) -> dict[str, Any]:
    """Kn = λ/L plus flow regime."""
    return _call(vacuum.knudsen_number, req.mfp, req.length)


@router.post("/pump-down")
def pump_down(req: PumpDownRequest) -> dict[str, Any]:
    """t = (V/S)·ln(P0/Pf) (s)."""
    return _call(vacuum.pump_down_time, req.v, req.s, req.p0, req.pf)


@router.post("/sputter-yield")
def sputter_yield(req: SputterYieldRequest) -> dict[str, Any]:
    """Y (atoms/ion) from the Ar-ion lookup table; NaN outside range."""
    return _call(vacuum.sputter_yield, req.material, req.energy, ion=req.ion)


@router.post("/gas-flow")
def gas_flow(req: GasFlowRequest) -> dict[str, Any]:
    """Molecular & viscous gas-flow conductance through a tube (L/s)."""
    return _call(
        vacuum.gas_flow,
        req.p1,
        req.p2,
        req.d,
        req.length,
        temperature=req.temperature,
        m=req.m,
    )
