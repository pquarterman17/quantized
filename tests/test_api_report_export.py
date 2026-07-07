"""Integration tests for /api/report/export (TestClient).

Rendering is covered in test_io_report_export; here we prove transport,
attachment headers, schema validation (422), and per-format content types.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.report import validate_report
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


# ── /api/report/emit (#36 — the viewer's emission front door) ──────────────
def test_emit_curve_fit_round_trips_schema() -> None:
    resp = client.post("/api/report/emit", json={
        "kind": "curve_fit",
        "result": {"params": [2.0, 0.5], "errors": [0.1, 0.02],
                   "R2": 0.998, "chiSqRed": 1.02, "RMSE": 0.03,
                   "AIC": -12.0, "nFree": 2, "nPoints": 50},
        "param_names": ["slope", "intercept"],
        "model_name": "Linear",
        "source_refs": [{"kind": "dataset", "id": "ds-1", "name": "scan A"}],
    })
    assert resp.status_code == 200
    report = resp.json()["report"]
    validate_report(report)  # emitted payload satisfies the #36 schema
    assert report["title"] == "Curve fit"
    assert report["created"]  # route stamps creation time
    params = report["sections"][0]["blocks"][1]["params"]
    assert params[0] == {"name": "slope", "value": 2.0, "error": 0.1}
    assert report["source_refs"][0]["id"] == "ds-1"


def test_emit_multipeak_fit() -> None:
    resp = client.post("/api/report/emit", json={
        "kind": "multipeak_fit",
        "result": {"peaks": [{"model": "gaussian", "center": 1.0, "fwhm": 0.2,
                              "height": 5.0, "area": 1.1}],
                   "rmse": 0.01, "nPeaks": 1, "model": "gaussian"},
        "title": "XRD peaks",
    })
    assert resp.status_code == 200
    report = resp.json()["report"]
    validate_report(report)
    assert report["title"] == "XRD peaks"


def test_emit_stats_table_needs_records() -> None:
    resp = client.post("/api/report/emit", json={"kind": "stats_table"})
    assert resp.status_code == 422


def test_emit_unknown_kind_is_422() -> None:
    resp = client.post("/api/report/emit",
                       json={"kind": "nope", "result": {"a": 1}})
    assert resp.status_code == 422


def test_emit_mismatched_param_names_is_422_not_500() -> None:
    resp = client.post("/api/report/emit", json={
        "kind": "curve_fit",
        "result": {"params": [1.0, 2.0]},
        "param_names": ["only-one"],
    })
    assert resp.status_code == 422
