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


def test_correlate_options_reach_the_calc_and_are_recorded(client: TestClient) -> None:
    rng = np.random.default_rng(1)
    x, y = np.arange(12.0), np.arange(10.0)
    za, zb = rng.normal(size=(10, 12)) + 3, rng.normal(size=(10, 12)) + 3
    za[2, 2] = np.nan
    first = map_payload(za, x, y)
    first["values"] = [[None if v != v else v for v in row] for row in first["values"]]
    body = {"dataset": first, "other": map_payload(zb, x, y)}
    assert client.post(f"{URL}/correlate", json=body).status_code == 422  # blanks, global
    opts = {"normalize": "local", "subtract_means": False, "min_overlap": 0.5}
    r = client.post(f"{URL}/correlate", json={**body, **opts})
    assert r.status_code == 200, r.text
    me = r.json()["metadata"]["math_extras"]
    assert me["normalize"] == "local" and me["subtract_means"] is False and me["min_overlap"] == 0.5
    assert me["peak"]["blank_cells"] == 1
    bad = client.post(f"{URL}/correlate", json={**body, "min_overlap": 0})
    assert bad.status_code == 422


def test_solve_system_and_constrained(client: TestClient) -> None:
    r = client.post(
        f"{URL}/solve-system",
        json={"equations": ["x^2 + y^2 = 4", "y = x"], "guess": {"x": 1, "y": 0.5}},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["converged"] and j["point"] == pytest.approx([math.sqrt(2)] * 2, abs=1e-8)
    assert j["residual_norm"] < 1e-9 and j["warnings"] == []
    dep = client.post(
        f"{URL}/solve-system",
        json={"equations": ["x + y = 3", "2*x + 2*y = 6"], "guess": {"x": 1, "y": 1}},
    )
    assert dep.status_code == 200 and "not unique" in dep.json()["warnings"][0]
    flat = client.post(f"{URL}/solve-system", json={"equations": ["x^2 + 1 = 0"], "guess": {"x": 0}})
    assert flat.status_code == 200 and flat.json()["converged"] is False
    assert "Jacobian is singular" in flat.json()["warnings"][0] and "no real solution" in flat.json()["warnings"][0]
    nc = client.post(f"{URL}/solve-system", json={"equations": ["x^2 = -1"], "guess": {"x": 1}})
    assert nc.status_code == 200 and nc.json()["converged"] is False
    short = client.post(
        f"{URL}/solve-system", json={"equations": ["x + y = 1"], "guess": {"x": 1, "y": 1}}
    )
    assert short.status_code == 422 and "unknown" in short.json()["detail"]
    c = client.post(
        f"{URL}/optimize-constrained",
        json={
            "expr": "(x-2)^2 + (y-2)^2",
            "constraints": ["x + y <= 2", "x >= 0.5"],
            "guess": {"x": 0, "y": 0},
            "method": "trust-constr",
        },
    )
    assert c.status_code == 200, c.text
    cj = c.json()
    assert cj["point"] == pytest.approx([1, 1], abs=1e-3) and cj["converged"]
    assert [k["active"] for k in cj["constraints"]] == [True, False]
    bad = client.post(f"{URL}/optimize-constrained", json={"expr": "x", "constraints": ["x < 1"]})
    assert bad.status_code == 422
