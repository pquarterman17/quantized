"""Thin substrate routes. Wraps ``calc.substrates`` (reference table +
lattice-mismatch formula). Validate -> call the pure fn -> serialize.

GET endpoints expose the substrate reference table (list + single lookup);
the POST endpoint computes the epitaxial lattice mismatch f = (a_f - a_s)/a_s.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc import substrates

router = APIRouter(prefix="/api/substrates", tags=["substrates"])


class MismatchRequest(BaseModel):
    a_film: float
    a_sub: float


@router.get("")
def list_substrates() -> dict[str, list[dict[str, Any]]]:
    """Full substrate reference table (list of property dicts)."""
    return {"substrates": substrates.substrate_table()}


@router.get("/{name}")
def get_substrate(name: str) -> dict[str, Any]:
    """Single substrate property card by name (case-insensitive)."""
    try:
        return substrates.get_substrate(name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/mismatch")
def mismatch(req: MismatchRequest) -> dict[str, Any]:
    """f = (a_film - a_sub)/a_sub, with tensile/compressive/matched label."""
    try:
        return substrates.lattice_mismatch(req.a_film, req.a_sub)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
