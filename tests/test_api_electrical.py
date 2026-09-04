"""Integration tests for /api/electrical (TestClient) -- the two routes added
alongside the Hall-sweep and van der Pauw calculator UI (hall_analysis was
previously registry-only; van_der_pauw is new). Thin adapter over
calc.electrical; the math is reference-tested in test_electrical.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_hall_sweep_recovers_linear_slope(client: TestClient) -> None:
    # Synthetic R_xy = 2*H + 0.5 sweep -> slope 2 Ohm/T recovered by the fit.
    field = [0.0, 1.0, 2.0, 3.0, 4.0]
    ry = [2.0 * h + 0.5 for h in field]
    r = client.post(
        "/api/electrical/hall-sweep",
        json={"field": field, "hall_resistance": ry, "thickness": 1e-5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["fit_r2"] == pytest.approx(1.0, abs=1e-9)
    assert body["r_h"] == pytest.approx(2.0 * 1e-5 * 1e4, rel=1e-9)


def test_hall_sweep_requires_two_points(client: TestClient) -> None:
    r = client.post(
        "/api/electrical/hall-sweep",
        json={"field": [0.0], "hall_resistance": [1.0]},
    )
    assert r.status_code == 422


def test_van_der_pauw_symmetric(client: TestClient) -> None:
    r = client.post("/api/electrical/van-der-pauw", json={"r_a": 1.0, "r_b": 1.0})
    assert r.status_code == 200
    assert r.json()["Rs"] == pytest.approx(4.53236, abs=1e-4)


def test_van_der_pauw_with_thickness_returns_resistivity(client: TestClient) -> None:
    r = client.post(
        "/api/electrical/van-der-pauw", json={"r_a": 1.0, "r_b": 1.0, "thickness": 1e-5}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["rho"] == pytest.approx(body["Rs"] * 1e-5, rel=1e-9)


def test_van_der_pauw_rejects_nonpositive(client: TestClient) -> None:
    r = client.post("/api/electrical/van-der-pauw", json={"r_a": 0.0, "r_b": 1.0})
    assert r.status_code == 422


def test_hall_extreme_finite_input_is_422_not_500(client: TestClient) -> None:
    """Regression: v_h=1e-308 drove calc.electrical.hall_single_point's
    Hall-coefficient division to ZeroDivisionError, which the route's old
    `except ValueError` did not catch -> Internal Server Error."""
    r = client.post(
        "/api/electrical/hall", json={"v_h": 1e-308, "i": 1.0, "b": 1.0, "t": 1.0}
    )
    assert r.status_code == 422, r.text


def test_mobility_extreme_finite_input_is_422_not_500(client: TestClient) -> None:
    """Regression: rho=1e-308 drove calc.electrical.mobility to a
    ZeroDivisionError escaping as a 500."""
    r = client.post("/api/electrical/mobility", json={"rho": 1e-308, "n": 1.0})
    assert r.status_code == 422, r.text
