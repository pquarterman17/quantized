"""Thin electrochemistry routes. Wraps ``calc.electrochemistry`` (pure
formulas): Nernst potential / Butler-Volmer / Tafel slope / ohmic (iR) drop /
double-layer capacitance. Validate -> call the pure fn -> serialize.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import electrochemistry

router = APIRouter(prefix="/api/electrochemistry", tags=["electrochemistry"])


class NernstRequest(BaseModel):
    e0: float
    n: float
    q: float
    t: float = 298.15


class ButlerVolmerRequest(BaseModel):
    j0: float
    eta: float
    alpha: float = 0.5
    t: float = 298.15


class TafelRequest(BaseModel):
    alpha: float
    t: float = 298.15


class OhmicDropRequest(BaseModel):
    i: float
    r: float


class DoubleLayerRequest(BaseModel):
    epsilon: float
    d: float  # nm
    area: float  # cm^2


def _call(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/nernst")
def nernst(req: NernstRequest) -> dict[str, Any]:
    """E = E⁰ − (R·T)/(n·F)·ln(Q) (V)."""
    return _call(electrochemistry.nernst_potential, req.e0, req.n, req.q, t=req.t)


@router.post("/butler-volmer")
def butler_volmer(req: ButlerVolmerRequest) -> dict[str, Any]:
    """j = j₀·[exp(αFη/RT) − exp(−(1−α)Fη/RT)] (A/cm²)."""
    return _call(electrochemistry.butler_volmer, req.j0, req.eta, alpha=req.alpha, t=req.t)


@router.post("/tafel-slope")
def tafel_slope(req: TafelRequest) -> dict[str, Any]:
    """b = 2.303·R·T/(α·F) (V/decade)."""
    return _call(electrochemistry.tafel_slope, req.alpha, t=req.t)


@router.post("/ohmic-drop")
def ohmic_drop(req: OhmicDropRequest) -> dict[str, Any]:
    """V_IR = I·R (V)."""
    return _call(electrochemistry.ohmic_drop, req.i, req.r)


@router.post("/double-layer-capacitance")
def double_layer_capacitance(req: DoubleLayerRequest) -> dict[str, Any]:
    """C = ε₀·ε_r·A/d (F)."""
    return _call(electrochemistry.double_layer_capacitance, req.epsilon, req.d, req.area)
