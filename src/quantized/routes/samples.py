"""Thin route serving the bundled first-run demo dataset.

A tiny synthetic hysteresis-loop CSV (``samples/demo_vsm.csv`` — generated,
never real instrument data) ships inside the package so a fresh install has
something to plot with zero setup. :func:`quantized.io.import_auto` parses it
through the exact same path as any user file, so the response is an ordinary
DataStruct import payload, not a special-cased shape.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from quantized.io import import_auto
from quantized.routes._payload import datastruct_payload

router = APIRouter(prefix="/api/samples", tags=["samples"])

_DEMO_FILE = Path(__file__).resolve().parent.parent / "samples" / "demo_vsm.csv"


@router.get("/demo")
def get_demo() -> dict[str, Any]:
    """The bundled first-run demo dataset (a synthetic VSM-like hysteresis loop)."""
    if not _DEMO_FILE.is_file():
        # Only possible on a broken install (samples/ stripped from the
        # wheel) — fail loudly instead of silently returning nothing.
        raise HTTPException(status_code=500, detail=f"demo sample missing: {_DEMO_FILE.name}")
    return datastruct_payload(import_auto(_DEMO_FILE))
