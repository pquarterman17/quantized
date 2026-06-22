"""Thin export routes: DataStruct -> downloadable file (XRD CSV / HDF5).

Wraps ``io.xrd_csv`` (pure in-memory text) and ``io.hdf5`` (writes a binary
file; we stage it in a temp dir and stream the bytes back). No formatting logic
here — the writers own it. The user-supplied filename is sanitized before it
reaches the Content-Disposition header (no header injection / path traversal).
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.datastruct import DataStruct
from quantized.io.hdf5 import write_hdf5
from quantized.io.xrd_csv import format_xrd_csv

router = APIRouter(prefix="/api/export", tags=["export"])


def _safe_name(name: str, ext: str) -> str:
    """Filename safe for a Content-Disposition header: keep only word chars,
    dot, dash; guarantee the extension. Prevents CRLF/quote injection +
    path traversal."""
    base = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "export"
    if not base.lower().endswith(ext):
        base += ext
    return base


def _attachment(name: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{name}"'}


class XrdCsvRequest(BaseModel):
    dataset: dict[str, Any]
    fmt: str = "standard"
    intensity: str = "both"
    include_metadata: bool = True
    filename: str = "export.csv"


class Hdf5Request(BaseModel):
    dataset: dict[str, Any]
    corrected: dict[str, Any] | None = None
    corrections: dict[str, float] | None = None
    filename: str = "export.h5"


@router.post("/xrd-csv")
def export_xrd_csv(req: XrdCsvRequest) -> Response:
    """XRD data -> CSV (standard) or Origin ASCII text, as a file download."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        text = format_xrd_csv(
            ds,
            fmt=req.fmt,
            intensity=req.intensity,
            include_metadata=req.include_metadata,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=text,
        media_type="text/csv",
        headers=_attachment(_safe_name(req.filename, ".csv")),
    )


@router.post("/hdf5")
def export_hdf5(req: Hdf5Request) -> Response:
    """DataStruct (+ optional corrected/corrections) -> self-describing HDF5."""
    try:
        ds = DataStruct.from_dict(req.dataset)
        corr = DataStruct.from_dict(req.corrected) if req.corrected else None
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "export.h5"
            write_hdf5(ds, out, corr_data=corr, corrections=req.corrections)
            payload = out.read_bytes()
    except ImportError as exc:  # h5py absent (declared runtime dep, but be safe)
        raise HTTPException(
            status_code=501, detail="HDF5 export requires h5py"
        ) from exc
    except (ValueError, KeyError, IndexError, FileNotFoundError, FileExistsError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=payload,
        media_type="application/x-hdf5",
        headers=_attachment(_safe_name(req.filename, ".h5")),
    )
