"""Integration tests for /api/math-extras (thin adapters over the math calc modules)."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.io._array_books import grid_map_datastruct

URL = "/api/math-extras"


def map_payload(z: np.ndarray, x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    ds = grid_map_datastruct(
        z, x, y, x_label="x", x_unit="nm", y_label="y", y_unit="nm", z_unit="a.u."
    )
    return ds.to_dict()


def test_polygon_area_unit_square(client: TestClient) -> None:
    r = client.post(f"{URL}/polygon-area", json={"x": [0, 1, 1, 0], "y": [0, 0, 1, 1]})
    assert r.status_code == 200, r.text
    assert r.json()["area"] == pytest.approx(1.0)
    assert r.json()["self_intersecting"] is False


def test_polygon_area_errors_are_422(client: TestClient) -> None:
    assert client.post(f"{URL}/polygon-area", json={"x": [0, 1], "y": [0, 1]}).status_code == 422
    assert client.post(f"{URL}/polygon-area", json={"x": [0, 1, 2], "y": [0, 1]}).status_code == 422


def test_surface_area_of_a_plane_map(client: TestClient) -> None:
    x, y = np.linspace(0, 2, 5), np.linspace(0, 2, 5)
    xx, yy = np.meshgrid(x, y)
    r = client.post(f"{URL}/surface-area", json={"dataset": map_payload(xx + yy, x, y)})
    assert r.status_code == 200, r.text
    assert r.json()["surface_area"] == pytest.approx(4 * math.sqrt(3))
    notamap = client.post(
        f"{URL}/surface-area", json={"dataset": {"time": [0, 1, 2], "values": [[1], [2], [3]]}}
    )
    assert notamap.status_code == 422


def test_trace_returns_a_dataset(client: TestClient) -> None:
    body = {"x": [0, 3], "y": [0, 4], "n": 6, "x_label": "X", "y_label": "Y"}
    r = client.post(f"{URL}/trace", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["time"] == pytest.approx([0, 0.6, 1.2, 1.8, 2.4, 3.0])
    assert d["labels"] == ["Y", "Arc length"]
    assert d["metadata"]["math_extras"]["total_length"] == pytest.approx(5.0)
    both = client.post(f"{URL}/trace", json={**body, "spacing": 1})
    assert both.status_code == 422


def test_bspline_returns_a_dataset(client: TestClient) -> None:
    x = np.linspace(0, 3, 30)
    r = client.post(f"{URL}/bspline", json={"x": x.tolist(), "y": (x**2).tolist(), "spacing": 0.5})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["time"] == pytest.approx([0, 0.5, 1, 1.5, 2, 2.5, 3])
    assert [v[0] for v in d["values"]] == pytest.approx([0, 0.25, 1, 2.25, 4, 6.25, 9], abs=1e-6)


def test_scatter_3d_and_bad_dimension(client: TestClient) -> None:
    rng = np.random.default_rng(3)
    pts = rng.random((60, 3))
    w = pts.sum(axis=1)
    body = {
        "points": pts.tolist(),
        "values": w.tolist(),
        "queries": [[0.5, 0.5, 0.5]],
        "method": "rbf",
        "coord_labels": ["a", "b", "c"],
        "value_label": "w",
    }
    r = client.post(f"{URL}/scatter", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["labels"] == ["b", "c", "w"] and d["values"][0][-1] == pytest.approx(1.5, abs=1e-6)
    assert client.post(f"{URL}/scatter", json={**body, "queries": [[0.5, 0.5]]}).status_code == 422


def test_correlate_two_maps(client: TestClient) -> None:
    x, y = np.arange(30.0), np.arange(24.0)
    xx, yy = np.meshgrid(x, y)

    def g(x0: float, y0: float) -> np.ndarray:
        return np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / 8)

    body = {"dataset": map_payload(g(15, 12), x, y), "other": map_payload(g(12, 10), x, y)}
    r = client.post(f"{URL}/correlate", json=body)
    assert r.status_code == 200, r.text
    meta = r.json()["metadata"]
    assert meta["is2D"] is True
    peak = meta["math_extras"]["peak"]
    assert (peak["offset_x"], peak["offset_y"]) == pytest.approx((3.0, 2.0), abs=0.1)
    other = map_payload(g(12, 10)[:, :20], x[:20], y)
    assert client.post(f"{URL}/correlate", json={**body, "other": other}).status_code == 200
    bad = map_payload(g(12, 10), x * 2, y)
    assert client.post(f"{URL}/correlate", json={**body, "other": bad}).status_code == 422


def test_solve_root_and_optimize(client: TestClient) -> None:
    r = client.post(
        f"{URL}/solve-root", json={"expr": "x^2 - a", "lo": 0, "hi": 5, "constants": {"a": 9}}
    )
    assert r.status_code == 200, r.text
    assert r.json()["roots"] == pytest.approx([3.0])
    no_root = client.post(f"{URL}/solve-root", json={"expr": "x^2+1", "lo": -1, "hi": 1})
    assert no_root.status_code == 422 and "no sign change" in no_root.json()["detail"]
    syntax = client.post(f"{URL}/solve-root", json={"expr": "x +", "lo": -1, "hi": 1})
    assert syntax.status_code == 422
    o = client.post(f"{URL}/optimize", json={"expr": "(x-2)^2+1", "bounds": {"x": [0, 5]}})
    assert o.status_code == 200, o.text
    assert o.json()["point"] == pytest.approx([2.0], abs=1e-5)
    assert o.json()["value"] == pytest.approx(1.0)
    missing = client.post(f"{URL}/optimize", json={"expr": "x+a", "bounds": {"x": [0, 5]}})
    assert missing.status_code == 422
