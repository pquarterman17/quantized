"""Thin export routes: DataStruct -> downloadable file (XRD CSV / HDF5).

Wraps ``io.xrd_csv`` (pure in-memory text) and ``io.hdf5`` (writes a binary
file; we stage it in a temp dir and stream the bytes back). No formatting logic
here — the writers own it. The user-supplied filename is sanitized before it
reaches the Content-Disposition header (no header injection / path traversal).
"""

from __future__ import annotations

import re
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
from quantized.io.origin import format_origin_script
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


class OriginRequest(BaseModel):
    dataset: dict[str, Any]
    filename: str = "export"
    log_x: bool = False
    log_y: bool = False
    make_graph: bool = True


class ConsolidatedItem(BaseModel):
    dataset: dict[str, Any]
    name: str = ""


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


class FigureRequest(BaseModel):
    dataset: dict[str, Any]
    x_key: int | str | None = None
    y_keys: list[int | str] | None = None
    x_log: bool = False
    y_log: bool = False
    fmt: str = "pdf"
    style: str = "default"  # publication preset: aps / report / web / …
    dpi: int = 200  # raster (png/tiff) resolution; ignored by vector formats
    title: str = ""  # optional figure title
    x_label: str | None = None  # override the auto-derived axis labels (None = derive)
    y_label: str | None = None
    filename: str = "figure"


_FIGURE_MIME = {
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
    "png": "image/png",
    "tiff": "image/tiff",
}
_DPI_MIN, _DPI_MAX = 50, 1200  # clamp: guards against absurd allocations


@router.post("/figure")
def export_figure(req: FigureRequest) -> Response:
    """Render the dataset (selected channels + log scales) to a publication
    figure: PDF / SVG (vector) or PNG / TIFF (raster, at ``dpi``)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    # Lazy import: matplotlib is heavy — only pay it when a figure is exported.
    from quantized.calc.figure import render_figure
    from quantized.calc.plotting import PlotState, build_series

    try:
        ds = DataStruct.from_dict(req.dataset)
        state = PlotState(
            x_key=req.x_key,
            y_keys=tuple(req.y_keys) if req.y_keys is not None else None,
            x_log=req.x_log,
            y_log=req.y_log,
        )
        plot = build_series(ds, state)
        # Caller-supplied labels override the auto-derived "label (unit)" strings.
        x_label = req.x_label
        if x_label is None:
            x_label = f"{plot.x_label} ({plot.x_unit})" if plot.x_unit else plot.x_label
        y_label = req.y_label
        if y_label is None:
            y_label = ""
            if len(plot.series) == 1:
                only = plot.series[0]
                y_label = f"{only.label} ({only.unit})" if only.unit else only.label
        series = [
            (f"{s.label} ({s.unit})" if s.unit else s.label, s.values) for s in plot.series
        ]
        data = render_figure(
            plot.x,
            series,
            title=req.title,
            x_label=x_label,
            y_label=y_label,
            x_log=req.x_log,
            y_log=req.y_log,
            fmt=req.fmt,
            style=req.style,
            dpi=dpi,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )
