"""Integration tests for /api/optics (TestClient) -- error-mapping regression
coverage. The math is reference-tested in test_optics.py; this file proves
the transport layer turns finite-but-extreme input into a 4xx, never a 500."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_fresnel_extreme_finite_input_is_422_not_500() -> None:
    """Regression: n1=1e308 drove calc.optics.fresnel_coefficients' complex
    exponentiation to OverflowError, escaping the route's old
    `except ValueError` as an Internal Server Error."""
    r = client.post("/api/optics/fresnel", json={"n1": 1e308, "n2": 1.0, "theta": 1.0})
    assert r.status_code == 422, r.text


def test_refractive_to_dielectric_extreme_finite_input_is_422_not_500() -> None:
    """Regression: n=1e308 overflowed calc.optics.refractive_to_dielectric's
    n**2 term."""
    r = client.post("/api/optics/refractive-to-dielectric", json={"n": 1e308, "k": 0.0})
    assert r.status_code == 422, r.text


def test_dielectric_to_refractive_extreme_finite_input_is_422_not_500() -> None:
    """Regression: eps1=1e308 overflowed calc.optics.dielectric_to_refractive's
    internal squaring."""
    r = client.post(
        "/api/optics/dielectric-to-refractive", json={"eps1": 1e308, "eps2": 0.0}
    )
    assert r.status_code == 422, r.text
