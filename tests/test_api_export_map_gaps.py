"""/api/export/map-figure accepts the map payload exactly as /api/plot/map
serves it: NaN cells (outside the data hull) travel as JSON ``null``, so the
vector map export can post the on-screen grid unchanged."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _gappy_map() -> dict[str, object]:
    x = np.linspace(-2.0, 2.0, 8)
    y = np.linspace(-1.0, 1.0, 6)
    xg, yg = np.meshgrid(x, y)
    z: list[list[float | None]] = (100.0 * np.exp(-(xg**2 + yg**2))).tolist()
    z[0][0] = None  # a hull gap, as the map payload encodes NaN
    z[5][7] = None
    return {"x_axis": x.tolist(), "y_axis": y.tolist(), "z_grid": z}


def test_map_figure_accepts_null_gap_cells_as_nan() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={**_gappy_map(), "kind": "heatmap", "fmt": "svg"},
    )
    assert resp.status_code == 200, resp.text
    assert b"<svg" in resp.content[:400]


def test_map_figure_null_gaps_contourf_pdf() -> None:
    resp = client.post(
        "/api/export/map-figure",
        json={**_gappy_map(), "kind": "contourf", "fmt": "pdf", "levels": 6},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content[:5] == b"%PDF-"
