"""Integration tests for the /api/plot route (TestClient)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
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


def test_plot_series_x_key_overrides_x_axis() -> None:
    # Pick the "Temp" channel (index 1) as the x-axis; plot Moment vs Temp.
    # The frontend sends y_keys excluding the x channel, so Temp is not replotted.
    resp = client.post(
        "/api/plot/series",
        json={"dataset": _MULTI, "x_key": 1, "y_keys": [0]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"][0] == [0.5, 0.6, 0.7]  # x is the Temp column
    assert body["x"]["label"] == "Temp"
    assert body["x"]["unit"] == "K"
    assert [s["label"] for s in body["series"]] == ["Moment"]
    assert body["data"][1] == [10.0, 20.0, 30.0]


def test_plot_series_x_key_by_label() -> None:
    body = client.post(
        "/api/plot/series",
        json={"dataset": _MULTI, "x_key": "Temp", "y_keys": ["Moment"]},
    ).json()
    assert body["x"]["label"] == "Temp"
    assert [s["label"] for s in body["series"]] == ["Moment"]


# ── /api/plot/map (2-D heatmap grid) ──────────────────────────────────────
# Scattered (x, y, z) packed as three channels; z = 2x + 3y + 1 (a plane).
_MAP_DS = {
    "time": [0.0, 1.0, 2.0, 3.0, 4.0],
    "values": [
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 3.0],
        [0.0, 1.0, 4.0],
        [1.0, 1.0, 6.0],
        [0.5, 0.5, 3.5],
    ],
    "labels": ["Qx", "Qz", "Intensity"],
    "units": ["1/A", "1/A", "cps"],
    "metadata": {"source": "/tmp/rsm.dat"},
}


def test_plot_map_grid_shape_and_labels() -> None:
    resp = client.post(
        "/api/plot/map",
        json={"dataset": _MAP_DS, "x_key": 0, "y_key": 1, "z_key": 2,
              "method": "linear", "nx": 6, "ny": 5},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["x_axis"]) == 6
    assert len(body["y_axis"]) == 5
    assert len(body["z_grid"]) == 5  # ny rows
    assert len(body["z_grid"][0]) == 6  # nx cols
    assert body["x"]["label"] == "Qx"
    assert body["z"]["label"] == "Intensity"
    assert body["z"]["unit"] == "cps"
    # z range over the plane on [0,1]^2: min at (0,0)=1, max at (1,1)=6.
    assert body["z"]["min"] == pytest.approx(1.0, abs=1e-6)
    assert body["z"]["max"] == pytest.approx(6.0, abs=1e-6)


def test_plot_map_keys_by_label() -> None:
    resp = client.post(
        "/api/plot/map",
        json={"dataset": _MAP_DS, "x_key": "Qx", "y_key": "Qz", "z_key": "Intensity",
              "method": "idw", "nx": 4, "ny": 4},
    )
    assert resp.status_code == 200
    assert resp.json()["y"]["label"] == "Qz"


def test_plot_map_out_of_hull_serializes_as_null() -> None:
    # A triangle hull leaves the rectangular grid's far corner outside -> NaN -> null.
    tri = {
        "time": [0.0, 1.0, 2.0],
        "values": [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0]],
        "labels": ["x", "y", "z"],
        "units": ["", "", ""],
        "metadata": {},
    }
    resp = client.post(
        "/api/plot/map",
        json={"dataset": tri, "x_key": 0, "y_key": 1, "z_key": 2,
              "method": "linear", "nx": 5, "ny": 5},
    )
    assert resp.status_code == 200
    z = resp.json()["z_grid"]
    flat = [v for row in z for v in row]
    assert None in flat  # the (1,1) corner is outside the triangle hull


def test_plot_map_clamps_grid_resolution() -> None:
    # nx/ny above the Field ceiling are rejected by validation (DoS guard).
    resp = client.post(
        "/api/plot/map",
        json={"dataset": _MAP_DS, "x_key": 0, "y_key": 1, "z_key": 2, "nx": 9999},
    )
    assert resp.status_code == 422


def test_plot_map_too_few_points_is_422() -> None:
    two = {
        "time": [0.0, 1.0],
        "values": [[0.0, 0.0, 1.0], [1.0, 1.0, 2.0]],
        "labels": ["x", "y", "z"],
        "units": ["", "", ""],
        "metadata": {},
    }
    resp = client.post(
        "/api/plot/map",
        json={"dataset": two, "x_key": 0, "y_key": 1, "z_key": 2},
    )
    assert resp.status_code == 422
