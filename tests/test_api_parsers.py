"""Integration tests for the /api/parsers routes (TestClient)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "qd_edp124.dat"


def test_import_qd_returns_datastruct() -> None:
    resp = client.post("/api/parsers/import", json={"path": str(FIXTURE)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["labels"] == ["Moment"]
    assert body["units"] == ["emu"]
    assert len(body["time"]) == 401
    assert len(body["values"]) == 401
    assert body["metadata"]["parser_name"] == "import_qd_vsm"


def test_import_missing_file_404() -> None:
    resp = client.post("/api/parsers/import", json={"path": "definitely_not_here.dat"})
    assert resp.status_code == 404


def test_import_unknown_format_422(tmp_path: Path) -> None:
    bogus = tmp_path / "mystery.zzz"
    bogus.write_text("not a known format")
    resp = client.post("/api/parsers/import", json={"path": str(bogus)})
    assert resp.status_code == 422
