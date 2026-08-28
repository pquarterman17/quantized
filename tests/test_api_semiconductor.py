"""Integration tests for /api/semiconductor (TestClient) -- error-mapping
regression coverage. The math is reference-tested in test_semiconductor.py;
this file proves the transport layer turns finite-but-extreme input into a
4xx, never a 500."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_carrier_concentration_extreme_finite_input_is_422_not_500() -> None:
    """Regression: nd=1e308 overflowed calc.semiconductor.carrier_concentration's
    net**2 term, escaping the route's old `except ValueError` as a 500."""
    r = client.post(
        "/api/semiconductor/carrier-concentration",
        json={"nd": 1e308, "na": 1.0, "ni": 1.0},
    )
    assert r.status_code == 422, r.text


def test_built_in_potential_extreme_finite_input_is_422_not_500() -> None:
    """Regression: all-tiny na/nd/ni drove calc.semiconductor.built_in_potential's
    log(na*nd/ni**2) argument to 0/0, a ZeroDivisionError."""
    r = client.post(
        "/api/semiconductor/built-in-potential",
        json={"na": 1e-308, "nd": 1e-308, "ni": 1e-308},
    )
    assert r.status_code == 422, r.text


def test_debye_length_extreme_finite_input_is_422_not_500() -> None:
    """Regression: n=1e-308 drove calc.semiconductor.debye_length's
    1/(q^2 * n_m3) term to a ZeroDivisionError."""
    r = client.post(
        "/api/semiconductor/debye-length", json={"n": 1e-308, "epsilon_r": 11.7}
    )
    assert r.status_code == 422, r.text


def test_thermal_velocity_extreme_finite_input_is_422_not_500() -> None:
    """Regression: m_star=1e-308 drove calc.semiconductor.thermal_velocity's
    3*kB*T/(m_star*m0) term to a ZeroDivisionError."""
    r = client.post(
        "/api/semiconductor/thermal-velocity", json={"m_star": 1e-308, "t": 1.0}
    )
    assert r.status_code == 422, r.text


def test_hall_coefficient_extreme_finite_input_is_422_not_500() -> None:
    """Regression: n=1e308 overflowed calc.semiconductor.hall_coefficient's
    n*mu_e**2 term."""
    r = client.post(
        "/api/semiconductor/hall-coefficient",
        json={"n": 1e308, "p": 1.0, "mu_e": 1.0, "mu_h": 1.0},
    )
    assert r.status_code == 422, r.text


def test_mobility_model_extreme_finite_input_is_422_not_500() -> None:
    """Regression: t=1e-308 drove calc.semiconductor.mobility_model's
    (t/300)**beta (beta<0) term to OverflowError."""
    r = client.post(
        "/api/semiconductor/mobility-model", json={"material": "Si", "t": 1e-308, "n": 1.0}
    )
    assert r.status_code == 422, r.text


def test_carrier_concentration_heavy_doping_no_longer_500s() -> None:
    """Regression (D8): ordinary heavy p-type doping (na=1e19 >> ni=1e10)
    used to catastrophically cancel to net=0 in the naive
    0.5*(net+sqrt(net**2+4*ni**2)) form, then ZeroDivisionError on
    p = ni**2/n. This must return real physics, not a 4xx or 5xx."""
    r = client.post(
        "/api/semiconductor/carrier-concentration",
        json={"nd": 1e17, "na": 1e19, "ni": 1e10},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n"] == pytest.approx(10.1010101010101, rel=1e-6)
    assert body["type"] == "p"
