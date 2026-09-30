"""Integration test for /api/magnetic/curie-weiss-fit (TestClient). The route
already existed (backend + calc-level tests in test_magnetic.py) with no
frontend caller until the MagneticTab Curie-Weiss fit card; this is its first
route-level coverage."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.calc import magnetic


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


@pytest.mark.parametrize(
    ("body", "kwargs"),
    [
        ({"shape": "cylinder", "length": 3.0, "diameter": 1.0}, {"length": 3.0, "diameter": 1.0}),
        ({"shape": "prolate", "ratio": 5.0}, {"ratio": 5.0}),
        ({"shape": "oblate", "ratio": 10.0}, {"ratio": 10.0}),
    ],
)
def test_demag_custom_matches_calc(
    client: TestClient, body: dict[str, Any], kwargs: dict[str, float]
) -> None:
    """Custom geometry (dimensions, not a preset label) -> calc.magnetic.demag_factor."""
    r = client.post("/api/magnetic/demag-custom", json=body)
    assert r.status_code == 200, r.text
    expected = magnetic.demag_factor(str(body["shape"]), **kwargs)
    out = r.json()
    assert out["Nz"] == pytest.approx(expected["Nz"], rel=1e-12)
    assert out["Nxy"] == pytest.approx(expected["Nxy"], rel=1e-12)
    assert out["n_cgs"] == pytest.approx(expected["n_cgs"], rel=1e-12)
    assert out["shape"] == body["shape"]


@pytest.mark.parametrize(
    "body",
    [
        '{"shape": "prolate", "ratio": 1.0}',  # a spheroid needs ratio > 1
        '{"shape": "cylinder", "length": 0.0, "diameter": 1.0}',
        '{"shape": "cube", "ratio": 2.0}',  # preset labels go through /demag
        '{"shape": "oblate", "ratio": Infinity}',
    ],
)
def test_demag_custom_rejects_bad_geometry(client: TestClient, body: str) -> None:
    r = client.post(
        "/api/magnetic/demag-custom", content=body, headers={"content-type": "application/json"}
    )
    assert r.status_code == 422, r.text
