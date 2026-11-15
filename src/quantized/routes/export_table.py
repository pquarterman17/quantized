"""Thin route: a worksheet table -> CSV / TSV / Excel download (audit #8).

``POST /api/export/worksheet`` takes the sheets the frontend laid out
(``lib/worksheetTable.ts``: the worksheet's own column order, chosen rows,
date X and text columns already resolved) and returns the file. All layout
lives in ``io.table_export``; this only validates and serializes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from quantized.csv_safe import with_excel_bom
from quantized.io.table_export import ExportColumn, ExportSheet, format_delimited, format_xlsx
from quantized.routes._errors import CALC_ERRORS
from quantized.routes._export_common import _attachment_named
from quantized.routes._offloop import OffloopJSONRoute

router = APIRouter(prefix="/api/export", tags=["export"], route_class=OffloopJSONRoute)

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class TableColumn(BaseModel):
    """One column: Long Name, unit, kind (``number``/``text``/``datetime``)
    and one cell per row (numbers, strings, or null for a blank)."""

    name: str
    unit: str = ""
    kind: Literal["number", "text", "datetime"] = "number"
    cells: list[float | str | None]


class TableSheet(BaseModel):
    name: str = "Sheet1"
    columns: list[TableColumn] = Field(min_length=1)


class WorksheetExportRequest(BaseModel):
    """``fmt`` csv/tsv write the FIRST sheet; xlsx writes every sheet as a
    tab. ``header``: write the Long Name (and Units) rows."""

    sheets: list[TableSheet] = Field(min_length=1)
    fmt: Literal["csv", "tsv", "xlsx"] = "csv"
    header: bool = True
    filename: str = "worksheet"


def _sheet(s: TableSheet) -> ExportSheet:
    return ExportSheet(s.name, [ExportColumn(c.name, c.unit, c.kind, c.cells) for c in s.columns])


@router.post("/worksheet")
def export_worksheet(req: WorksheetExportRequest) -> Response:
    """Worksheet (or a selection of it) -> CSV, TSV or Excel, as a download."""
    try:
        if req.fmt == "xlsx":
            payload = format_xlsx([_sheet(s) for s in req.sheets], header=req.header)
            return Response(
                payload, media_type=_XLSX, headers=_attachment_named(req.filename, ".xlsx")
            )
        delim = "," if req.fmt == "csv" else "\t"
        text = format_delimited(_sheet(req.sheets[0]), delim, header=req.header)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    media = "text/csv" if req.fmt == "csv" else "text/tab-separated-values"
    ext = f".{req.fmt}"
    return Response(
        with_excel_bom(text), media_type=media, headers=_attachment_named(req.filename, ext)
    )
