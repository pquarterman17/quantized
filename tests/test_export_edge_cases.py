"""Export edge cases deferred from #814: each fails closed with a clear
message instead of a bare index error, a blank 200 or a silent drop."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

DATASET = {
    "time": [0.0, 1.0, 2.0],
    "values": [[10.0], [40.0], [90.0]],
    "labels": ["Signal"],
    "units": ["V"],
    "metadata": {},
}


def _figure(**body: Any) -> Any:
    return client.post("/api/export/figure", json={"dataset": DATASET, "fmt": "svg", **body})


def test_figure_out_of_range_y_key_is_a_clear_422() -> None:
    r = _figure(y_keys=[5])
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "tuple index out of range" not in detail
    assert "channel 5" in detail and "1 channel" in detail


def test_figure_unknown_y_label_is_a_clear_422() -> None:
    r = _figure(y_keys=["Nope"])
    assert r.status_code == 422
    assert "Nope" in r.json()["detail"] and "Signal" in r.json()["detail"]


def test_figure_out_of_range_x_key_is_a_clear_422() -> None:
    r = _figure(x_key=7)
    assert r.status_code == 422
    assert "channel 7" in r.json()["detail"]


def test_all_nan_heatmap_is_a_422_like_the_contour_kinds() -> None:
    nan_grid: list[list[float | None]] = [[None] * 4 for _ in range(3)]
    body = {
        "x_axis": [0.0, 1.0, 2.0, 3.0],
        "y_axis": [0.0, 1.0, 2.0],
        "z_grid": nan_grid,
        "fmt": "svg",
    }
    heat = client.post("/api/export/map-figure", json={**body, "kind": "heatmap"})
    cont = client.post("/api/export/map-figure", json={**body, "kind": "contourf"})
    assert cont.status_code == 422
    assert heat.status_code == 422, heat.status_code
    assert "NaN" in heat.json()["detail"]
