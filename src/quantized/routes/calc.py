"""Thin headless-calculator routes — an HTTP surface for the calc registry.

Exposes the same discoverable, name-addressed calculator catalog as
``calc.registry`` (the DiraCulator headless API) over HTTP: list the operations,
describe one's parameters, or invoke one by name with a params dict. Validate →
call the pure registry → JSON-serialize. No business logic here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.registry import call_calculator, describe_calculator, list_calculators
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/calc", tags=["calc"])


class CallRequest(BaseModel):
    name: str
    params: dict[str, Any] = Field(default_factory=dict)


def _detail(exc: Exception) -> str:
    """Clean message text (KeyError.__str__ wraps its arg in quotes)."""
    return str(exc.args[0]) if exc.args else str(exc)


@router.get("/catalog")
def catalog(domain: str | None = None) -> dict[str, Any]:
    """List calculator operations (``{name, domain, summary}``); optionally one domain."""
    return {"calculators": list_calculators(domain)}


@router.get("/describe/{name}")
def describe(name: str) -> dict[str, Any]:
    """Describe one operation: name, domain, summary, and its signature params."""
    try:
        return describe_calculator(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=_detail(exc)) from exc


@router.post("/call")
def call(req: CallRequest) -> dict[str, Any]:
    """Invoke a calculator by name with a params dict; JSON-serialize the result."""
    try:
        result = call_calculator(req.name, req.params)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=_detail(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=_detail(exc)) from exc
    return {"name": req.name, "result": to_jsonable(result)}
