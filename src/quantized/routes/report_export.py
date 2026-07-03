"""Thin route: render a report sheet to LaTeX / HTML / Word / PowerPoint (#37/#38).

Validates the posted report against the #36 schema, calls the pure
``io.report_export`` renderer, and streams the file back as an attachment.
Missing optional office libraries surface as 501; unknown formats as 422.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from quantized.calc.report import validate_report
from quantized.io.report_export import ReportExportError, render_report

router = APIRouter(prefix="/api/report", tags=["report"])

_EXT = {"latex": ".tex", "html": ".html", "docx": ".docx", "pptx": ".pptx"}


def _safe_name(name: str, ext: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "report"
    return stem if stem.endswith(ext) else stem + ext


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
