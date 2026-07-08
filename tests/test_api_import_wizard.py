"""Integration tests for /api/import (TestClient). Engine is golden in
test_io_import_preview; here we prove transport + settings round-trip + 422s.

The /filters routes (gap #40 persistence) get their own isolated config dir
per test (autouse fixture) so this suite never touches the real user config."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_MESSY = "\n".join([
    "# header comment",
    "Temp,Moment",
    "(K),(emu)",
    "300,0.0012",
    "250,0.0015",
    "200,0.0021",
])

_WEIRD_SETTINGS = {
    "delimiter": ",", "header_line": 1, "units_line": 2, "data_start_line": 3,
    "column_names": ["Temp", "Moment"], "roles": ["x", "y"],
}


@pytest.fixture(autouse=True)
def isolated_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QZ_CONFIG_DIR", str(tmp_path / "qzconfig"))


def test_guess_then_preview_then_parse() -> None:
    g = client.post("/api/import/guess", json={"text": _MESSY})
    assert g.status_code == 200
    settings = g.json()
    assert settings["column_names"] == ["Temp", "Moment"]
    assert settings["roles"] == ["x", "y"]

    pv = client.post("/api/import/preview", json={"text": _MESSY, "settings": settings})
    assert pv.status_code == 200
    body = pv.json()
    assert [c["unit"] for c in body["columns"]] == ["K", "emu"]
    assert body["rows"][0] == [300.0, 0.0012]

    ds = client.post("/api/import/parse", json={"text": _MESSY, "settings": settings})
    assert ds.status_code == 200
    payload = ds.json()
    assert payload["labels"] == ["Moment"]
    assert payload["units"] == ["emu"]


def test_preview_without_settings_autoguesses() -> None:
    pv = client.post("/api/import/preview", json={"text": _MESSY})
    assert pv.status_code == 200
    assert pv.json()["delimiter"] == ","


def test_parse_no_channels_is_422() -> None:
    resp = client.post(
        "/api/import/parse",
        json={"text": "x\n1\n2", "settings": {"header_line": 0, "data_start_line": 1,
                                              "roles": ["x"]}},
    )
    assert resp.status_code == 422


# ── /api/import/filters CRUD ─────────────────────────────────────────────


def test_filters_crud_roundtrip() -> None:
    assert client.get("/api/import/filters").json() == []

    resp = client.post(
        "/api/import/filters",
        json={"name": "Messy XYZ", "glob": "*.weird", "settings": _WEIRD_SETTINGS},
    )
    assert resp.status_code == 200
    saved = resp.json()
    assert saved["name"] == "Messy XYZ" and saved["glob"] == "*.weird" and saved["updated"]

    listed = client.get("/api/import/filters").json()
    assert len(listed) == 1 and listed[0]["name"] == "Messy XYZ"

    deleted = client.delete("/api/import/filters/Messy XYZ")
    assert deleted.status_code == 200
    assert client.get("/api/import/filters").json() == []


def test_save_filter_upserts_by_name() -> None:
    client.post("/api/import/filters",
                json={"name": "A", "glob": "*.dat", "settings": _WEIRD_SETTINGS})
    client.post("/api/import/filters",
                json={"name": "A", "glob": "*.txt", "settings": _WEIRD_SETTINGS})
    listed = client.get("/api/import/filters").json()
    assert len(listed) == 1 and listed[0]["glob"] == "*.txt"


def test_save_filter_empty_name_is_422() -> None:
    resp = client.post(
        "/api/import/filters", json={"name": "   ", "glob": "*.dat", "settings": {}}
    )
    assert resp.status_code == 422


def test_delete_missing_filter_is_404() -> None:
    resp = client.delete("/api/import/filters/Nope")
    assert resp.status_code == 404


# ── /api/import/filters/parse ("import with filter") ─────────────────────


def test_import_with_filter_by_name() -> None:
    client.post("/api/import/filters",
                json={"name": "Messy", "glob": "*.weird", "settings": _WEIRD_SETTINGS})
    resp = client.post("/api/import/filters/parse",
                        json={"text": _MESSY, "filter_name": "Messy"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["labels"] == ["Moment"] and body["units"] == ["emu"]


def test_import_with_filter_by_filename_match() -> None:
    client.post("/api/import/filters",
                json={"name": "Messy", "glob": "*.weird", "settings": _WEIRD_SETTINGS})
    resp = client.post("/api/import/filters/parse",
                        json={"text": _MESSY, "filename": "run1.weird"})
    assert resp.status_code == 200
    assert resp.json()["labels"] == ["Moment"]


def test_import_with_filter_unknown_name_is_404() -> None:
    resp = client.post("/api/import/filters/parse",
                        json={"text": _MESSY, "filter_name": "Nope"})
    assert resp.status_code == 404


def test_import_with_filter_no_filename_match_is_404() -> None:
    resp = client.post("/api/import/filters/parse",
                        json={"text": _MESSY, "filename": "nope.zzz"})
    assert resp.status_code == 404


def test_import_with_filter_requires_filename_or_name() -> None:
    resp = client.post("/api/import/filters/parse", json={"text": _MESSY})
    assert resp.status_code == 422
