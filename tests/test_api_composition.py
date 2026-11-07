"""Integration tests for /api/composition (TestClient). Thin adapter over
calc.composition; the math is reference-tested in test_calc_composition.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_atomic_to_weight_and_back() -> None:
    wt = client.post(
        "/api/composition/atomic-to-weight", json={"elements": ["Fe", "O"], "values": [2, 3]}
    )
    assert wt.status_code == 200
    body = wt.json()
    assert body["elements"] == ["Fe", "O"]
    assert sum(body["weight_pct"]) == pytest.approx(100.0)
    back = client.post(
        "/api/composition/weight-to-atomic",
        json={"elements": ["Fe", "O"], "values": body["weight_pct"]},
    )
    assert back.status_code == 200
    assert back.json()["atomic_pct"] == pytest.approx([40.0, 60.0], rel=1e-12)


def test_percent_routes_reject_mismatch_and_unknown_element() -> None:
    mismatch = client.post(
        "/api/composition/atomic-to-weight", json={"elements": ["Fe", "O"], "values": [1]}
    )
    assert mismatch.status_code == 422
    unknown = client.post(
        "/api/composition/weight-to-atomic", json={"elements": ["Qq"], "values": [100]}
    )
    assert unknown.status_code == 422


def test_co_deposition_route() -> None:
    r = client.post(
        "/api/composition/co-deposition",
        json={"formula": "La0.7Sr0.3MnO3", "sources": ["La2O3", "SrO", "MnO"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ratios"] == pytest.approx([0.35 / 0.3, 1.0, 1.0 / 0.3], rel=1e-12)
    assert body["warnings"] == []
    unmatched = client.post(
        "/api/composition/co-deposition", json={"formula": "SrTiO3", "sources": ["MgO"]}
    )
    assert unmatched.status_code == 422
