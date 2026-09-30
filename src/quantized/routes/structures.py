"""Thin crystal-structure import routes (CIF).

A CIF is a CRYSTAL STRUCTURE - a unit cell, a space group and atom sites - not
a time/value series. It has no sampled axis, so it does not fit the DataStruct
contract (``.time`` / ``.values`` / ``.labels``) and is deliberately NOT
imported as a dataset: ``io/registry.py`` names ``.cif`` a structure format,
refuses it on the DataStruct path (``/api/parsers/*``) with a pointer here, and
dispatches it through :func:`quantized.io.registry.import_structure`. These
routes return the parsed structure as a :class:`CrystalStructure`; the SPA
keeps it as a lattice preset for the XRD tools (Pawley's starting cell).

``/upload`` takes the browser's file picker / drag-drop bytes; ``/import``
takes a path the server can see (the desktop shell's native dialog), under the
same allowed-roots-or-consent rule as ``/api/parsers/import``.
Validate -> call io -> serialize; no parsing here.
"""

from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from quantized.desktop_consent import consented_path
from quantized.io.registry import import_structure, is_structure_file
from quantized.routes._errors import CALC_ERRORS_IO
from quantized.routes._uploadstream import UploadTooLargeError, stream_to_path
from quantized.routes.parsers import _allowed_prefixes

router = APIRouter(prefix="/api/structures", tags=["structures"])

# A CIF is text of a few kB to a few MB (a large protein mmCIF is the outlier
# and not what the XRD tools want); 32 MiB refuses a mis-picked binary early.
STRUCTURE_MAX_BYTES = 32 * 1024 * 1024
_CELL_KEYS = ("a", "b", "c", "alpha", "beta", "gamma")


class UnitCell(BaseModel):
    """Lengths in angstrom, angles in degrees; null when the CIF omits one."""

    a: float | None
    b: float | None
    c: float | None
    alpha: float | None
    beta: float | None
    gamma: float | None


class AtomSite(BaseModel):
    label: str
    symbol: str
    x: float | None
    y: float | None
    z: float | None
    occupancy: float | None


class CrystalStructure(BaseModel):
    name: str
    source_name: str
    formula: str
    space_group: str
    cell: UnitCell
    atom_sites: list[AtomSite]


class StructurePathRequest(BaseModel):
    path: str


def _finite(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else None


def _payload(parsed: dict[str, Any], source_name: str) -> dict[str, Any]:
    cell = {k: _finite(parsed["cellParams"].get(k)) for k in _CELL_KEYS}
    if all(v is None for v in cell.values()):
        raise ValueError(f"'{source_name}' has no unit cell (_cell_length_* / _cell_angle_*)")
    sites = [
        {"label": s["label"], "symbol": s["symbol"],
         **{k: _finite(s[k]) for k in ("x", "y", "z", "occupancy")}}
        for s in parsed["atomSites"]
    ]
    return {
        "name": parsed["blockName"] or Path(source_name).stem,
        "source_name": source_name,
        "formula": parsed["formula"],
        "space_group": parsed["spaceGroup"],
        "cell": cell,
        "atom_sites": sites,
    }


def _parse(path: Path, source_name: str) -> dict[str, Any]:
    try:
        return _payload(import_structure(path), source_name)
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/upload", response_model=CrystalStructure)
async def upload_structure(file: UploadFile) -> dict[str, Any]:
    """Parse an uploaded ``.cif`` into its crystal structure."""
    name = Path(file.filename or "upload.cif").name or "upload.cif"
    if not is_structure_file(Path(name)):
        raise HTTPException(status_code=422, detail=f"'{name}' is not a .cif file")
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / name
        try:
            await stream_to_path(file, dest, filename=name, max_bytes=STRUCTURE_MAX_BYTES)
        except UploadTooLargeError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except CALC_ERRORS_IO as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return await run_in_threadpool(_parse, dest, name)


@router.post("/import", response_model=CrystalStructure)
def import_structure_path(req: StructurePathRequest) -> dict[str, Any]:
    """Parse a server-visible ``.cif`` path (the desktop shell's native pick)."""
    try:
        resolved = os.path.realpath(req.path)
    except (OSError, ValueError, ArithmeticError) as exc:
        raise HTTPException(status_code=400, detail="invalid path") from exc
    # Inline containment guard, the same as /api/parsers/import (kept inline so
    # the static analyzer sees the barrier between the taint and the sink).
    if resolved.startswith(_allowed_prefixes()):
        safe_path = resolved
    else:
        granted = consented_path(resolved)
        if granted is None:
            raise HTTPException(
                status_code=403,
                detail="path is outside the allowed roots (set QZ_DATA_ROOTS to widen)",
            )
        safe_path = granted
    if not os.path.isfile(safe_path):
        raise HTTPException(status_code=404, detail="file not found")
    if not is_structure_file(Path(safe_path)):
        raise HTTPException(status_code=422, detail="not a .cif file")
    return _parse(Path(safe_path), Path(safe_path).name)
