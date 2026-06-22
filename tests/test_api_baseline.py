"""Integration tests for /api/baseline (TestClient). Math is golden in
test_calc_baseline; here we prove the transport for all four methods."""

from __future__ import annotations

import numpy as np
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
