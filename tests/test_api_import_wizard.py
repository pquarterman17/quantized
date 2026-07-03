"""Integration tests for /api/import (TestClient). Engine is golden in
test_io_import_preview; here we prove transport + settings round-trip + 422s."""

from __future__ import annotations

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
