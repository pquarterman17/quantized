"""Thin routes: emit + render report sheets (#36/#37/#38).

``/emit`` maps an analysis result dict onto the #36 schema via the pure
``calc.report_emit`` emitters (one emission source of truth — the frontend
never re-shapes results itself). ``/export`` validates a posted report and
streams the rendered LaTeX / HTML / Word / PowerPoint file back as an
attachment. Missing optional office libraries surface as 501; unknown
formats/kinds as 422.

Figure blocks carrying a ``spec`` (a ``/api/export/figure`` request body) are
rendered first by ``routes.report_figures`` through the app's own figure
exporter (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6). A figure that cannot be rendered
or embedded never fails the export: the document carries a named placeholder
and the response lists it in the ``X-Report-Warnings`` header (a JSON array of
strings, ASCII-escaped; ``X-Report-Warning-Count`` holds the full count).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.calc import report_emit, report_emit_peaks, report_emit_sims
from quantized.calc.report import ReportSheet, validate_report
from quantized.io.report_export import ReportExportError, figure_target, render_report
from quantized.routes._errors import CALC_ERRORS, call_calc
from quantized.routes.report_figures import render_report_figures

router = APIRouter(prefix="/api/report", tags=["report"])

_EXT = {"latex": ".tex", "html": ".html", "docx": ".docx", "pptx": ".pptx"}
# Bound the warnings header (proxies cap header sizes): the first few messages,
# each truncated; the count header always carries the true total.
_MAX_WARNINGS, _MAX_WARNING_CHARS = 20, 300


def _safe_name(name: str, ext: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "report"
    return stem if stem.endswith(ext) else stem + ext


class ReportEmitRequest(BaseModel):
    """An analysis result + which emitter should shape it into a report."""

    # curve_fit | multipeak_fit | peak_model_fit | refl_fit | integrate |
    # batch_integrate | anova | stats_table | sims_region
    kind: str
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
        "multipeak_fit": report_emit_peaks.from_multipeak_fit,
        "peak_model_fit": report_emit_peaks.from_peak_model_fit,
        "refl_fit": report_emit.from_refl_fit,
        "integrate": report_emit.from_integrate,
        "batch_integrate": report_emit.from_batch_integrate,
        "anova": report_emit.from_anova,
        "sims_region": report_emit_sims.from_sims_region,
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
    sheet = call_calc(_emit_sheet, req)
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
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    warnings: list[str] = []
    try:
        figures = render_report_figures(req.report, figure_target(req.format))
        data, mime, _is_text = render_report(
            req.report, req.format, figures=figures, warnings=warnings
        )
    except ReportExportError as exc:
        # unknown format -> 422; a missing optional office lib -> 501
        code = 501 if "needs" in str(exc) else 422
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    filename = _safe_name(req.filename, _EXT.get(req.format, ""))
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if warnings:
        shown = [w[:_MAX_WARNING_CHARS] for w in warnings[:_MAX_WARNINGS]]
        headers["X-Report-Warnings"] = json.dumps(shown, ensure_ascii=True)
        headers["X-Report-Warning-Count"] = str(len(warnings))
    return Response(content=data, media_type=mime, headers=headers)
