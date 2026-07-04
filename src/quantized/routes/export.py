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
from quantized.io.origin import format_origin_project_script, format_origin_script
from quantized.io.origin_com import com_available, send_to_origin
from quantized.io.origin_project.writer import opj_bytes
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
    # Per-series style (aligned to the plotted y_keys order): color/width/line/marker.
    series_styles: list[dict[str, Any] | None] | None = None
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
            series_styles=req.series_styles,
            dpi=dpi,
        )
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class StatplotFigureRequest(BaseModel):
    kind: str  # box|violin|qq|probability|histogram
    data: list[list[float]] | list[float]  # groups (box/violin) or one sample
    labels: list[str] | None = None
    fmt: str = "pdf"
    style: str = "default"
    dist: str = "norm"
    bins: str | int = "fd"
    fit: str | None = None
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    dpi: int = 200
    filename: str = "statplot"


@router.post("/statplot-figure")
def export_statplot_figure(req: StatplotFigureRequest) -> Response:
    """Render a statistical plot (box/violin/Q-Q/histogram) to a publication
    figure (PDF/SVG/PNG/TIFF)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure_statplots import render_statplot_figure  # lazy: matplotlib

    try:
        data: Any = req.data
        data = [list(g) for g in data] if req.kind in ("box", "violin") else list(data)
        img = render_statplot_figure(
            req.kind, data, labels=req.labels, fmt=req.fmt, style=req.style,
            dist=req.dist, bins=req.bins, fit=req.fit,
            title=req.title, x_label=req.x_label, y_label=req.y_label, dpi=dpi,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=img,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
    )


class MapFigureRequest(BaseModel):
    x_axis: list[float]
    y_axis: list[float]
    z_grid: list[list[float]]  # (ny, nx), NaN allowed for gaps
    kind: str = "contourf"  # contourf|contour|heatmap|surface|scatter3d|waterfall
    fmt: str = "pdf"
    style: str = "default"
    dpi: int = 200
    cmap: str = "viridis"
    levels: int | list[float] = 12
    level_scale: str = "linear"  # linear|log
    label_contours: bool = True
    colorbar: bool = True
    title: str = ""
    x_label: str = ""
    y_label: str = ""
    z_label: str = ""
    width_in: float | None = None
    height_in: float | None = None
    view_elev: float = 30.0
    view_azim: float = -60.0
    filename: str = "map"


@router.post("/map-figure")
def export_map_figure(req: MapFigureRequest) -> Response:
    """Render a gridded 2-D map to a publication figure: filled/line contour,
    heatmap, or static 3-D surface/scatter/waterfall (PDF/SVG/PNG/TIFF)."""
    if req.fmt not in _FIGURE_MIME:
        raise HTTPException(
            status_code=422, detail=f"fmt must be one of {sorted(_FIGURE_MIME)}"
        )
    dpi = max(_DPI_MIN, min(_DPI_MAX, req.dpi))
    from quantized.calc.figure_map import render_map_figure  # lazy: matplotlib is heavy

    try:
        data = render_map_figure(
            req.x_axis, req.y_axis, req.z_grid,
            kind=req.kind, fmt=req.fmt, style=req.style, dpi=dpi, cmap=req.cmap,
            levels=req.levels, level_scale=req.level_scale,
            label_contours=req.label_contours, colorbar=req.colorbar,
            title=req.title, x_label=req.x_label, y_label=req.y_label, z_label=req.z_label,
            width_in=req.width_in, height_in=req.height_in,
            view_elev=req.view_elev, view_azim=req.view_azim,
        )
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type=_FIGURE_MIME[req.fmt],
        headers=_attachment(_safe_name(req.filename, f".{req.fmt}")),
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
