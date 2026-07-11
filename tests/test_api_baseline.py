"""Integration tests for /api/baseline (TestClient). Math is golden in
test_calc_baseline; here we prove the transport for all four methods."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _peak_on_background() -> tuple[list[float], list[float]]:
    x = np.linspace(0.0, 49.0, 50)
    bg = 0.1 * x + 2.0
    peak = 10.0 * np.exp(-((x - 25.0) ** 2) / (2 * 3.0**2))
    return list(x), list(bg + peak)


def test_estimate_snip_is_below_signal() -> None:
    x, y = _peak_on_background()
    resp = client.post("/api/baseline/estimate", json={"x": x, "y": y, "method": "snip"})
    assert resp.status_code == 200
    base = resp.json()["baseline"]
    assert len(base) == len(y)
    # estimate_background clamps to min(bg, y).
    assert all(b <= yi + 1e-9 for b, yi in zip(base, y, strict=True))


def test_estimate_bad_method_is_422() -> None:
    x, y = _peak_on_background()
    resp = client.post("/api/baseline/estimate", json={"x": x, "y": y, "method": "nope"})
    assert resp.status_code == 422


def test_als_returns_baseline() -> None:
    _, y = _peak_on_background()
    resp = client.post("/api/baseline/als", json={"y": y, "lam": 1e5, "p": 0.01})
    assert resp.status_code == 200
    assert len(resp.json()["baseline"]) == len(y)


def test_rollingball_returns_baseline_and_info() -> None:
    _, y = _peak_on_background()
    resp = client.post("/api/baseline/rollingball", json={"y": y, "radius": 10})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["baseline"]) == len(y)
    assert body["info"]["radius"] == 10


def test_modpoly_returns_baseline_and_info() -> None:
    _, y = _peak_on_background()
    resp = client.post("/api/baseline/modpoly", json={"y": y, "order": 3})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["baseline"]) == len(y)
    assert body["info"]["order"] == 3
    assert "converged" in body["info"]


def test_region_fits_box_background() -> None:
    x, y = _peak_on_background()
    resp = client.post(
        "/api/baseline/region",
        json={"x": x, "y": y, "x_min": 0.0, "x_max": 49.0, "y_max": 6.0, "order": 1},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["background"]) == len(y)
    assert body["order"] == 1
    # y_max=6 excludes the peak top → recovers the 0.1·x + 2 background line.
    assert body["coeffs"][0] == pytest.approx(0.1, abs=0.02)
    assert body["coeffs"][1] == pytest.approx(2.0, abs=0.3)
    assert body["n_points"] > 0


def test_region_too_few_points_is_422() -> None:
    x, y = _peak_on_background()
    resp = client.post(
        "/api/baseline/region",
        json={"x": x, "y": y, "x_min": 24.6, "x_max": 24.7, "order": 1},
    )
    assert resp.status_code == 422


def test_anchor_baseline_passes_through_anchors() -> None:
    x, y = _peak_on_background()
    anchors = [[0.0, 2.0], [20.0, 4.0], [49.0, 6.9]]
    resp = client.post(
        "/api/baseline/anchor",
        json={"x": x, "y": y, "anchors": anchors, "method": "pchip"},
    )
    assert resp.status_code == 200
    base = resp.json()["baseline"]
    assert len(base) == len(y)
    assert base[0] == pytest.approx(2.0)
    assert base[20] == pytest.approx(4.0)  # x grid is 0..49 step 1
    assert base[49] == pytest.approx(6.9)


def test_anchor_duplicate_x_is_422() -> None:
    x, y = _peak_on_background()
    resp = client.post(
        "/api/baseline/anchor",
        json={"x": x, "y": y, "anchors": [[5.0, 1.0], [5.0, 2.0]]},
    )
    assert resp.status_code == 422


def test_shirley_returns_baseline_and_info() -> None:
    x = list(np.linspace(0.0, 10.0, 201))
    peak = 5.0 * np.exp(-((np.asarray(x) - 5.0) ** 2) / (2 * 0.4**2))
    step = 0.5 * (1.0 + np.tanh((5.0 - np.asarray(x)) / 0.4))
    y = list(peak + step)
    resp = client.post("/api/baseline/shirley", json={"x": x, "y": y})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["baseline"]) == len(y)
    assert body["info"]["converged"] is True


def test_shirley_nonconvergence_is_422_not_500() -> None:
    x = list(np.linspace(0.0, 10.0, 201))
    peak = 5.0 * np.exp(-((np.asarray(x) - 5.0) ** 2) / (2 * 0.4**2))
    step = 0.5 * (1.0 + np.tanh((5.0 - np.asarray(x)) / 0.4))
    y = list(peak + step)
    resp = client.post(
        "/api/baseline/shirley", json={"x": x, "y": y, "max_iter": 1, "tol": 1e-15}
    )
    assert resp.status_code == 422
    assert "converge" in resp.json()["detail"]


def test_xrdlowangle_returns_baseline_and_info() -> None:
    x = list(np.linspace(1.0, 40.0, 100))
    y = [5.0 + 120.0 / v for v in x]
    resp = client.post("/api/baseline/xrdlowangle", json={"x": x, "y": y})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["baseline"]) == len(y)
    assert body["info"]["converged"] is True
    assert body["info"]["coeffs"][1] == pytest.approx(120.0, rel=1e-4)


def test_xrdlowangle_nonpositive_x_is_422() -> None:
    resp = client.post(
        "/api/baseline/xrdlowangle",
        json={"x": [0.0, 1.0, 2.0, 3.0], "y": [1.0, 1.0, 1.0, 1.0]},
    )
    assert resp.status_code == 422
