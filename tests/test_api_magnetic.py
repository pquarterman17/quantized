"""Integration test for /api/magnetic/curie-weiss-fit (TestClient). The route
already existed (backend + calc-level tests in test_magnetic.py) with no
frontend caller until the MagneticTab Curie-Weiss fit card; this is its first
route-level coverage."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_curie_weiss_fit_recovers_synthetic_parameters(client: TestClient) -> None:
    # MATLAB docstring example: C=4, theta=50, chi = C/(T-theta).
    temps = [float(t) for t in range(100, 401)]
    chi = [4.0 / (t - 50.0) for t in temps]
    r = client.post(
        "/api/magnetic/curie-weiss-fit",
        json={"temperature": temps, "susceptibility": chi, "fit_range": [150.0, 400.0]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["C"] == pytest.approx(4.0, rel=1e-6)
    assert body["theta_cw"] == pytest.approx(50.0, rel=1e-6)


def test_curie_weiss_fit_requires_three_points(client: TestClient) -> None:
    r = client.post(
        "/api/magnetic/curie-weiss-fit",
        json={"temperature": [100.0, 200.0], "susceptibility": [0.1, 0.2]},
    )
    assert r.status_code == 422


def test_langevin_extreme_finite_input_is_422_not_500(client: TestClient) -> None:
    """Regression: a huge field with a near-zero temperature drove
    calc.magnetic.langevin's saturation-argument division to
    ZeroDivisionError, escaping the route's old `except ValueError`."""
    r = client.post(
        "/api/magnetic/langevin",
        json={"mu": 1.0, "field_oe": 1e308, "temperature": 1e-308},
    )
    assert r.status_code == 422, r.text
