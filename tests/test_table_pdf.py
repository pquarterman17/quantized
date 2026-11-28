"""Worksheet export to PDF (export-writers item 35).

No PDF text reader is a dependency, so the page content is pinned through
``page_plan`` (what is drawn, as text) against the CSV writer's own cells, and
the file is checked structurally: a PDF whose page count equals the plan's.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.io.table_export import ExportColumn, ExportSheet, format_delimited
from quantized.io.table_pdf import (
    CELL_CHARS,
    COLS_PER_BLOCK,
    ROWS_PER_PAGE,
    format_pdf,
    page_plan,
)

client = TestClient(app)


def _sheet(n_rows: int = 5, n_cols: int = 3) -> ExportSheet:
    cols = [
        ExportColumn(
            f"C{k}", "mm" if k == 0 else "", "number", [r * 1.5 + k for r in range(n_rows)]
        )
        for k in range(n_cols)
    ]
    return ExportSheet("Run 1", cols)


def _pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page(?![s\w])", pdf))


def test_a_small_sheet_is_one_page_with_the_csv_cells() -> None:
    sheet = _sheet()
    (page,) = page_plan(sheet)
    csv_rows = [line.split(",") for line in format_delimited(sheet).splitlines()]
    assert page.title == "Run 1" and page.note == "rows 1-5"
    assert page.head == csv_rows[:2]  # Long Name row, Units row
    assert page.body == csv_rows[2:]
    assert page.body[1] == ["1.5", "2.5", "3.5"]  # numbers as in the CSV, not 1.50000


def test_header_off_and_blank_cells() -> None:
    col = ExportColumn("V", "", "number", [1.0, None, float("nan"), "2"])
    (page,) = page_plan(ExportSheet("s", [col]), header=False)
    assert page.head == [] and page.body == [["1"], [""], [""], ["2"]]


def test_long_text_is_cut_with_an_ellipsis() -> None:
    col = ExportColumn("T", "", "text", ["x" * 100])
    (page,) = page_plan(ExportSheet("s", [col]))
    assert page.body == [["x" * (CELL_CHARS - 1) + "…"]]


def test_rows_and_columns_paginate_and_say_where() -> None:
    n_rows, n_cols = 2 * ROWS_PER_PAGE + 1, COLS_PER_BLOCK + 3
    plan = page_plan(_sheet(n_rows, n_cols))
    assert len(plan) == 6  # 2 column blocks x 3 row pages
    assert plan[0].title == "Run 1 - page 1 of 6"
    assert plan[0].note == f"columns 1-{COLS_PER_BLOCK} of {n_cols}, rows 1-{ROWS_PER_PAGE}"
    assert plan[2].note.endswith(f"rows {2 * ROWS_PER_PAGE + 1}-{n_rows}")
    assert plan[3].note.startswith(f"columns {COLS_PER_BLOCK + 1}-{n_cols}")
    assert all(len(p.head) == 2 for p in plan)  # the header repeats on every page
    # every cell is on exactly one page
    assert sum(len(p.body) * len(p.body[0]) for p in plan) == n_rows * n_cols


def test_the_file_is_a_pdf_with_one_page_per_plan_page() -> None:
    sheets = [_sheet(), _sheet(ROWS_PER_PAGE + 5, 2)]
    pdf = format_pdf(sheets)
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    assert _pages(pdf) == sum(len(page_plan(s)) for s in sheets) == 3


def test_a_malformed_sheet_is_refused() -> None:
    one, none = ExportColumn("a", "", "number", [1.0]), ExportColumn("b", "", "number", [])
    bad = ExportSheet("b", [one, none])
    with pytest.raises(ValueError, match="different row counts"):
        format_pdf([bad])
    with pytest.raises(ValueError, match="nothing to export"):
        format_pdf([])


def test_route_returns_a_pdf_download() -> None:
    body = {
        "sheets": [{"name": "S", "columns": [
            {"name": "T", "unit": "K", "kind": "number", "cells": [1.0, 2.0]}]}],
        "fmt": "pdf",
        "filename": "my sheet",
    }
    r = client.post("/api/export/worksheet", json=body)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-") and ".pdf" in r.headers["content-disposition"]
    body["sheets"][0]["columns"][0]["cells"] = ["abc", 1.0]  # text in a number column
    assert client.post("/api/export/worksheet", json=body).status_code == 422
