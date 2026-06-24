"""Integration tests for the /api/plot route (TestClient)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "qd_edp124.dat"


def _import() -> dict[str, Any]:
    return client.post("/api/parsers/import", json={"path": str(FIXTURE)}).json()


def test_plot_series_from_imported_dataset() -> None:
    dataset = _import()
    resp = client.post("/api/plot/series", json={"dataset": dataset})
    assert resp.status_code == 200
    body = resp.json()
    # uPlot column data: [x, y] for the single Moment channel.
    assert len(body["data"]) == 2
    assert len(body["data"][0]) == 401  # x
    assert len(body["data"][1]) == 401  # y
    assert body["series"][0]["label"] == "Moment"
    assert body["x"]["label"] == "Magnetic Field"
    assert body["x"]["unit"] == "Oe"


def test_plot_series_nan_serializes_as_null() -> None:
    dataset = {
        "time": [1.0, 2.0, 3.0],
        "values": [[1.0], [None], [3.0]],  # null -> nan on parse
        "labels": ["m"],
        "units": ["emu"],
        "metadata": {},
    }
    resp = client.post("/api/plot/series", json={"dataset": dataset})
    assert resp.status_code == 200
    ydata = resp.json()["data"][1]
    assert ydata == [1.0, None, 3.0]  # non-finite came back as null


def test_plot_series_log_flags_passthrough() -> None:
    dataset = _import()
    resp = client.post("/api/plot/series", json={"dataset": dataset, "x_log": True, "y_log": True})
    assert resp.status_code == 200
    body = resp.json()
    assert body["x"]["log"] is True
    assert body["y"]["log"] is True


_MULTI = {
    "time": [1.0, 2.0, 3.0],
    "values": [[10.0, 0.5], [20.0, 0.6], [30.0, 0.7]],
    "labels": ["Moment", "Temp"],
    "units": ["emu", "K"],
    "metadata": {},
}


def test_plot_series_axis_defaults_to_primary() -> None:
    body = client.post("/api/plot/series", json={"dataset": _MULTI}).json()
    assert [s["axis"] for s in body["series"]] == [0, 0]


def test_plot_series_secondary_axis_assignment() -> None:
    # Put the "Temp" channel (index 1) on the secondary Y axis.
    resp = client.post("/api/plot/series", json={"dataset": _MULTI, "y2_keys": [1]})
    assert resp.status_code == 200
    series = resp.json()["series"]
    assert series[0]["label"] == "Moment" and series[0]["axis"] == 0
    assert series[1]["label"] == "Temp" and series[1]["axis"] == 1


def test_plot_series_secondary_axis_by_label() -> None:
    body = client.post("/api/plot/series", json={"dataset": _MULTI, "y2_keys": ["Temp"]}).json()
    assert [s["axis"] for s in body["series"]] == [0, 1]
