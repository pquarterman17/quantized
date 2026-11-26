"""/api/map-analysis: peaks and ROI volume over the wire (thin adapter checks)."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())

X = np.linspace(0.0, 10.0, 51)
Y = np.linspace(0.0, 8.0, 41)


def _map(z: np.ndarray) -> dict:
    gx, gy = np.meshgrid(X, Y)
    return {
        "time": gx.ravel().tolist(),
        "values": np.column_stack([gx.ravel(), gy.ravel(), z.ravel()]).tolist(),
        "labels": ["Field", "Temp", "Signal"],
        "units": ["T", "K", "V"],
        "metadata": {"is2D": True, "map_shape": [len(Y), len(X)], "map_grid": "native"},
    }


def _z() -> np.ndarray:
    gx, gy = np.meshgrid(X, Y)
    return np.asarray(50 * np.exp(-0.5 * (((gx - 4) / 0.8) ** 2 + ((gy - 3) / 0.6) ** 2)) + 2)


def test_peaks_returns_a_table_with_the_result_in_metadata() -> None:
    r = client.post("/api/map-analysis/peaks", json={"dataset": _map(_z()), "n_peaks": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["labels"][0] == "Field centre"
    peak = body["metadata"]["map_peaks"]["peaks"][0]
    assert abs(peak["x0"] - 4.0) < 0.05 and peak["ok"] is True


def test_volume_and_422_reasons() -> None:
    region = {"kind": "rect", "x0": 1, "x1": 7, "y0": 0.5, "y1": 5.5}
    r = client.post(
        "/api/map-analysis/volume",
        json={"dataset": _map(_z()), "region": region, "background": {"kind": "constant"}},
    )
    assert r.status_code == 200, r.text
    meta = r.json()["metadata"]["map_volume"]
    assert abs(meta["volume"] - 2 * np.pi * 50 * 0.8 * 0.6) < 5
    out = client.post(
        "/api/map-analysis/volume",
        json={"dataset": _map(_z()), "region": {**region, "x0": 50, "x1": 60}},
    )
    assert out.status_code == 422 and "no cells" in out.json()["detail"]
    bad = client.post("/api/map-analysis/peaks", json={"dataset": _map(np.ones((41, 51)))})
    assert bad.status_code == 422 and "flat" in bad.json()["detail"]
