"""Integration tests for /api/report/export (TestClient).

Rendering is covered in test_io_report_export; here we prove transport,
attachment headers, schema validation (422), and per-format content types.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.report_emit import from_anova
from quantized.calc.stats_anova2 import anova2

client = TestClient(app)

_REPORT = from_anova(
    anova2([[[130, 155, 74, 180], [34, 40, 80, 75]],
            [[150, 188, 159, 126], [136, 122, 106, 115]]])
).to_dict()


def test_latex_export_attachment() -> None:
    resp = client.post("/api/report/export",
                       json={"report": _REPORT, "format": "latex", "filename": "anova table"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/x-tex")
    assert 'filename="anova_table.tex"' in resp.headers["content-disposition"]
    assert r"\toprule" in resp.text


def test_html_export() -> None:
    resp = client.post("/api/report/export", json={"report": _REPORT, "format": "html"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert resp.text.startswith("<!doctype html>")


def test_invalid_report_is_422() -> None:
    resp = client.post("/api/report/export",
                       json={"report": {"sections": []}, "format": "html"})  # no title
    assert resp.status_code == 422


def test_unknown_format_is_422() -> None:
    resp = client.post("/api/report/export", json={"report": _REPORT, "format": "rtf"})
    assert resp.status_code == 422


def test_malformed_report_is_422_not_500() -> None:
    # non-dict entries in sections used to raise AttributeError -> 500
    resp = client.post(
        "/api/report/export",
        json={"report": {"title": "x", "sections": ["oops"]}, "format": "html"},
    )
    assert resp.status_code == 422


def test_docx_export_when_available() -> None:
    pytest.importorskip("docx")
    resp = client.post("/api/report/export", json={"report": _REPORT, "format": "docx"})
    assert resp.status_code == 200
    assert "wordprocessingml" in resp.headers["content-type"]
    assert resp.content[:2] == b"PK"


def test_pptx_export_when_available() -> None:
    pytest.importorskip("pptx")
    resp = client.post("/api/report/export", json={"report": _REPORT, "format": "pptx"})
    assert resp.status_code == 200
    assert "presentationml" in resp.headers["content-type"]
    assert resp.content[:2] == b"PK"
