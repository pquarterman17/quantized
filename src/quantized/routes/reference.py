"""Thin reference-data routes: physical constants, element table, unit convert.

Wraps the finished W4 backend helpers (``calc.constants``, ``calc.element_data``,
``calc.unit_convert``). Pure lookups + a unit-expression converter; no logic here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from quantized.calc.constants import constants
from quantized.calc.element_data import by_symbol, element_data
from quantized.calc.unit_convert import unit_convert
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/reference", tags=["reference"])


class ConvertRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    value: float | list[float]
    from_unit: str = Field(alias="from")
    to_unit: str = Field(alias="to")


@router.get("/constants")
def get_constants() -> dict[str, Any]:
    """CODATA physical constants (name -> value)."""
    return {"constants": to_jsonable(constants())}


@router.get("/elements")
def get_elements() -> dict[str, Any]:
    """The full 118-element table."""
    return {"elements": to_jsonable(element_data())}


@router.get("/elements/{symbol}")
def get_element(symbol: str) -> dict[str, Any]:
    """One element by symbol (e.g. ``Fe``)."""
    try:
        return to_jsonable(by_symbol(symbol))  # type: ignore[no-any-return]
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/convert")
def convert(req: ConvertRequest) -> dict[str, Any]:
    """Convert a value between unit expressions (e.g. ``Oe`` -> ``T``)."""
    try:
        result, info = unit_convert(req.value, req.from_unit, req.to_unit)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"result": to_jsonable(result), "info": to_jsonable(info)}
