"""Integration tests for /api/thin-film (TestClient) -- the sauerbrey route
added alongside the QCM calculator card. Thin adapter over calc.thin_film;
the math is reference-tested in test_thin_film.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_sauerbrey_5mhz_sensitivity_factor() -> None:
    r = client.post("/api/thin-film/sauerbrey", json={"delta_f": -10.0, "f0": 5e6})
    assert r.status_code == 200
    assert r.json()["Cf_hz_cm2_ug"] == pytest.approx(56.6, abs=0.05)


def test_sauerbrey_with_area_and_density() -> None:
    r = client.post(
        "/api/thin-film/sauerbrey",
        json={"delta_f": -10.0, "f0": 5e6, "area": 1.0, "density": 2.0},
    )
    assert r.status_code == 200
    body = r.json()
    assert "thickness" in body
    assert body["thickness_nm"] == pytest.approx(body["thickness"] * 1e7, rel=1e-9)


def test_sauerbrey_rejects_nonpositive_f0() -> None:
    r = client.post("/api/thin-film/sauerbrey", json={"delta_f": -10.0, "f0": 0.0})
    assert r.status_code == 422


def test_sauerbrey_extreme_finite_input_is_422_not_500() -> None:
    """Regression: f0=1e308 overflowed calc.thin_film.sauerbrey's f0**2 term,
    an uncaught OverflowError escaping the route's old `except ValueError`."""
    r = client.post("/api/thin-film/sauerbrey", json={"delta_f": 1.0, "f0": 1e308})
    assert r.status_code == 422, r.text


def test_kiessig_thickness_extreme_finite_input_is_422_not_500() -> None:
    """Regression: a huge delta_q with an sld correction overflows
    calc.thin_film.kiessig_thickness's delta_q**2 term."""
    r = client.post(
        "/api/thin-film/kiessig-thickness", json={"delta_q": 1e308, "sld": 1.0}
    )
    assert r.status_code == 422, r.text
