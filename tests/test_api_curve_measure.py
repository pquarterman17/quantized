"""Integration tests for /api/curve-measure (thin adapters over calc.curve_measure)."""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient


def test_intersect_sin_cos(client: TestClient) -> None:
    x = np.linspace(0, 2 * math.pi, 2001)
    body = {"x1": x.tolist(), "y1": np.sin(x).tolist(), "x2": x.tolist(), "y2": np.cos(x).tolist()}
    r = client.post("/api/curve-measure/intersect", json=body)
    assert r.status_code == 200, r.text
    got = r.json()["intersections"]
    assert [g["x"] for g in got] == pytest.approx([math.pi / 4, 5 * math.pi / 4], abs=1e-5)
    assert [g["direction"] for g in got] == ["rising", "falling"]


def test_intersect_errors_are_422(client: TestClient) -> None:
    no_overlap = {"x1": [0, 1], "y1": [0, 1], "x2": [2, 3], "y2": [0, 1]}
    r = client.post("/api/curve-measure/intersect", json=no_overlap)
    assert r.status_code == 422 and "overlap" in r.json()["detail"]
    ragged = {"x1": [0, 1, 2], "y1": [0, 1], "x2": [0, 1], "y2": [0, 1]}
    assert client.post("/api/curve-measure/intersect", json=ragged).status_code == 422
    nan = {"x1": [0, 1, 2], "y1": [0, None, 2], "x2": [0, 2], "y2": [0, 1]}
    assert client.post("/api/curve-measure/intersect", json=nan).status_code == 422


def test_level_crossings_with_dead_band(client: TestClient) -> None:
    x = np.linspace(0, 4 * math.pi, 4001)
    body = {"x": x.tolist(), "y": np.sin(x).tolist(), "level": 0.5, "hysteresis": 0.1}
    r = client.post("/api/curve-measure/level-crossings", json=body)
    assert r.status_code == 200, r.text
    assert [c["direction"] for c in r.json()["crossings"]] == [
        "rising",
        "falling",
        "rising",
        "falling",
    ]
    bad = client.post("/api/curve-measure/level-crossings", json={**body, "hysteresis": -1})
    assert bad.status_code == 422


def test_step_time_closed_form(client: TestClient) -> None:
    tau = 2.0
    t = np.linspace(0, 10 * tau, 4001)
    body = {
        "x": t.tolist(),
        "y": (1 - np.exp(-t / tau)).tolist(),
        "low_level": 0.0,
        "high_level": 1.0,
    }
    r = client.post("/api/curve-measure/step-time", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["time"] == pytest.approx(tau * math.log(9), rel=1e-4)
    assert d["edge"] == "rise" and d["plateaus_estimated"] == [False, False]
    flat = client.post("/api/curve-measure/step-time", json={"x": t.tolist(), "y": [1.0] * t.size})
    assert flat.status_code == 422
