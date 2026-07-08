"""Thin export routes: DataStruct -> downloadable file (data formats).

Wraps data exporters: ``io.xrd_csv`` (pure in-memory text), ``io.hdf5``
(writes a binary file; staged in temp dir), and ``io.origin`` (LabTalk scripts
for Origin). No formatting logic here — writers own it. Figure rendering is
in ``routes.export_figures``. Filenames are sanitized before the
Content-Disposition header.
"""

from __future__ import annotations

import tempfile
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.datastruct import DataStruct
from quantized.io.consolidated import consolidate_csv
from quantized.io.hdf5 import write_hdf5
from quantized.io.origin import GraphSpec, format_origin_project_script, format_origin_script
from quantized.io.origin_com import com_available, send_to_origin
from quantized.io.origin_project.writer import opj_bytes
from quantized.io.xrd_csv import format_xrd_csv
from quantized.routes._export_common import _attachment, _safe_name

router = APIRouter(prefix="/api/export", tags=["export"])


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


class OriginGraphSpec(BaseModel):
    """Current plot-state snapshot for the ``.ogs`` GRAPH block (item 26) —
    wire model for ``io.origin.GraphSpec``. Indices are 0-based value-channel
    positions (same as ``PlotState``): ``y_keys=None`` means "all channels"."""

    y_keys: list[int] | None = None
    x_key: int | None = None
    x_log: bool = False
    y_log: bool = False
    x_lim: tuple[float, float] | None = None
    y_lim: tuple[float, float] | None = None
    y2_keys: list[int] = []


class OriginRequest(BaseModel):
    dataset: dict[str, Any]
    filename: str = "export"
    log_x: bool = False
    log_y: bool = False
    make_graph: bool = True
    graph: OriginGraphSpec | None = None


class ConsolidatedItem(BaseModel):
    dataset: dict[str, Any]
    name: str = ""


class OpjRequest(BaseModel):
    datasets: list[ConsolidatedItem]
    filename: str = "project"


class OriginComRequest(BaseModel):
    datasets: list[ConsolidatedItem]


class ConsolidatedRequest(BaseModel):
    datasets: list[ConsolidatedItem]
    fmt: str = "standard"
    filename: str = "consolidated.csv"


@router.post("/origin")
def export_origin(req: OriginRequest) -> Response:
    """DataStruct -> a ZIP of an Origin LabTalk ``.ogs`` script + its CSV."""
    stem = _safe_name(req.filename, "")
    csv_name = f"{stem}_data.csv"
    created = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    graph_spec = None
    if req.graph is not None:
        g = req.graph
        graph_spec = GraphSpec(
            y_keys=tuple(g.y_keys) if g.y_keys is not None else None,
            x_key=g.x_key,
            x_log=g.x_log,
            y_log=g.y_log,
            x_lim=g.x_lim,
            y_lim=g.y_lim,
            y2_keys=tuple(g.y2_keys),
        )
    try:
        ds = DataStruct.from_dict(req.dataset)
        csv_text, ogs_text = format_origin_script(
            ds,
            csv_name=csv_name,
            book_name=stem,
            sheet_name=stem,
            log_x=req.log_x,
            log_y=req.log_y,
            make_graph=req.make_graph,
            created=created,
            graph=graph_spec,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{stem}.ogs", ogs_text)
        zf.writestr(csv_name, csv_text)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers=_attachment(_safe_name(stem, ".zip")),
    )


@router.post("/consolidated")
def export_consolidated(req: ConsolidatedRequest) -> Response:
    """Multiple datasets -> one role-based CSV (per-dataset Q + value blocks)."""
    try:
        items = [(DataStruct.from_dict(it.dataset), it.name) for it in req.datasets]
        text = consolidate_csv(items, fmt=req.fmt)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=text,
        media_type="text/csv",
        headers=_attachment(_safe_name(req.filename, ".csv")),
    )


@router.post("/opj")
def export_opj(req: OpjRequest) -> Response:
    """DataStructs -> a native Origin ``.opj`` project (readable by ANY Origin
    version — Origin ≥2023 dropped writing .opj but still opens it)."""
    try:
        books = []
        for item in req.datasets:
            ds = DataStruct.from_dict(item.dataset)
            if item.name and "origin_book" not in ds.metadata:
                meta = dict(ds.metadata)
                meta["origin_book"] = item.name
                ds = DataStruct(
                    time=ds.time,
                    values=ds.values,
                    labels=ds.labels,
                    units=ds.units,
                    metadata=meta,
                )
            books.append(ds)
        payload = opj_bytes(books)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    stem = _safe_name(req.filename, "")
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers=_attachment(f"{stem}.opj"),
    )


@router.post("/origin-project")
def export_origin_project(req: OpjRequest) -> Response:
    """DataStructs -> a ZIP holding one LabTalk ``.ogs`` + one CSV per book."""
    created = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    try:
        items = [(DataStruct.from_dict(i.dataset), i.name) for i in req.datasets]
        csvs, ogs_text = format_origin_project_script(items, created=created)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    stem = _safe_name(req.filename, "")
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{stem}.ogs", ogs_text)
        for csv_name, csv_text in csvs:
            zf.writestr(csv_name, csv_text)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers=_attachment(_safe_name(stem, ".zip")),
    )


@router.get("/origin-com/status")
def origin_com_status() -> dict[str, bool]:
    """Whether COM "Send to Origin" (item 25) is usable right now: Windows +
    pywin32 + ``QZ_ORIGIN_COM=1`` + (unverified here) a running OriginPro
    instance. The UI uses this to show/hide the action; everywhere it is
    False, use ``/origin`` or ``/origin-project`` instead."""
    return {"available": com_available()}


@router.post("/origin-com")
def export_origin_com(req: OriginComRequest) -> dict[str, Any]:
    """DataStructs -> new workbooks in a RUNNING Origin instance via COM
    (item 25, Windows-only optional). 409 when COM is unavailable or Origin
    rejects the push — use ``/origin`` or ``/origin-project`` instead."""
    if not req.datasets:
        raise HTTPException(status_code=422, detail="datasets must be non-empty")
    if not com_available():
        raise HTTPException(
            status_code=409,
            detail=(
                "Origin COM is unavailable on this machine (needs Windows, "
                "pywin32, QZ_ORIGIN_COM=1, and a running OriginPro instance). "
                "Use POST /api/export/origin or /api/export/origin-project instead."
            ),
        )
    try:
        items = [DataStruct.from_dict(i.dataset) for i in req.datasets]
        book_names = [i.name for i in req.datasets]
        result = send_to_origin(items, book_names=book_names)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return result
