"""Thin routes: emit + render report sheets (#36/#37/#38).

``/emit`` maps an analysis result dict onto the #36 schema via the pure
``calc.report_emit`` emitters (one emission source of truth — the frontend
never re-shapes results itself). ``/export`` validates a posted report and
streams the rendered LaTeX / HTML / Word / PowerPoint file back as an
attachment. Missing optional office libraries surface as 501; unknown
formats/kinds as 422.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.calc import report_emit
from quantized.calc.report import ReportSheet, validate_report
from quantized.io.report_export import ReportExportError, render_report

router = APIRouter(prefix="/api/report", tags=["report"])

_EXT = {"latex": ".tex", "html": ".html", "docx": ".docx", "pptx": ".pptx"}


def _safe_name(name: str, ext: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "report"
    return stem if stem.endswith(ext) else stem + ext


class ReportEmitRequest(BaseModel):
    """An analysis result + which emitter should shape it into a report."""

    kind: str  # curve_fit | multipeak_fit | integrate | batch_integrate | anova | stats_table
    result: dict[str, Any] | None = None
    records: list[dict[str, Any]] | None = None  # stats_table input
    title: str | None = None
    model_name: str | None = None
    param_names: list[str] | None = None
    param_units: list[str] | None = None
    columns: list[str] | None = None
    caption: str | None = None
    source_refs: list[dict[str, Any]] = []


def _emit_sheet(req: ReportEmitRequest) -> ReportSheet:
    """Dispatch to the matching pure emitter (no eval — explicit table)."""
    kind = req.kind
    refs = req.source_refs
    if kind == "stats_table":
        if not req.records:
            raise ValueError("stats_table needs non-empty 'records'")
        return report_emit.from_stats_table(
            req.records, title=req.title or "Statistics",
            columns=req.columns, caption=req.caption, source_refs=refs,
        )
    if req.result is None:
        raise ValueError(f"kind {kind!r} needs a 'result' object")
    if kind == "curve_fit":
        return report_emit.from_curve_fit(
            req.result, param_names=req.param_names or [],
            param_units=req.param_units, title=req.title or "Curve fit",
            model_name=req.model_name, source_refs=refs,
        )
    simple = {
        "multipeak_fit": report_emit.from_multipeak_fit,
        "integrate": report_emit.from_integrate,
        "batch_integrate": report_emit.from_batch_integrate,
        "anova": report_emit.from_anova,
    }
    if kind not in simple:
        raise ValueError(f"unknown report kind {kind!r}")
    kwargs: dict[str, Any] = {"source_refs": refs}
    if req.title:
        kwargs["title"] = req.title
    return simple[kind](req.result, **kwargs)


@router.post("/emit")
def emit_report(req: ReportEmitRequest) -> dict[str, Any]:
    """Result dict + kind -> a validated #36 report sheet (JSON)."""
    try:
        sheet = _emit_sheet(req)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload = sheet.to_dict()
    # calc stays deterministic/pure; the route stamps the creation time.
    payload["created"] = datetime.now(UTC).isoformat(timespec="seconds")
    return {"report": payload}


class ReportExportRequest(BaseModel):
    report: dict[str, Any]
    format: str = "html"
    filename: str = "report"


@router.post("/export")
def export_report(req: ReportExportRequest) -> Response:
    """Report dict + format -> downloadable file (.tex/.html/.docx/.pptx)."""
    try:
        validate_report(req.report)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        data, mime, _is_text = render_report(req.report, req.format)
    except ReportExportError as exc:
        # unknown format -> 422; a missing optional office lib -> 501
        code = 501 if "needs" in str(exc) else 422
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    filename = _safe_name(req.filename, _EXT.get(req.format, ""))
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
