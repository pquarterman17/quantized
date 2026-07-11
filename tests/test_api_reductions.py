"""Thin-route integration tests for /api/reductions (routes/reductions.py).

The math is golden-verified in test_calc_reductions.py; these only check the
adapters validate, dispatch, and serialize.
"""

from __future__ import annotations

import math

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())


def test_williamson_hall_route() -> None:
    resp = client.post(
        "/api/reductions/williamson-hall",
        json={"two_theta_deg": [30.1, 43.2, 57.0], "fwhm_deg": [0.25, 0.28, 0.32]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["grain_size_nm"] > 0
    assert len(body["plot_x"]) == 3


def test_williamson_hall_route_validation_422() -> None:
    resp = client.post(
        "/api/reductions/williamson-hall",
        json={"two_theta_deg": [30.1], "fwhm_deg": [0.25]},
    )
    assert resp.status_code == 422


def test_fft_thickness_route() -> None:
    tt = np.linspace(15, 35, 201)
    q = (4 * math.pi / 1.5406) * np.sin(np.deg2rad(tt / 2))
    intensity = 500 * (1 + 0.45 * np.cos(q * 800)) + 50
    resp = client.post(
        "/api/reductions/fft-thickness",
        json={
            "two_theta_deg": tt.tolist(),
            "intensity": intensity.tolist(),
            "wavelength_a": 1.5406,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["thickness_nm" ] > 0


def test_reflectivity_fft_route_neutron() -> None:
    q = np.linspace(0.01, 0.12, 201)
    r = np.maximum(q, 1e-3) ** -4.0 * (1 + 0.4 * np.cos(q * 1200))
    resp = client.post(
        "/api/reductions/reflectivity-fft",
        json={"x": q.tolist(), "reflectivity": (r / r.max()).tolist(), "is_neutron": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["thicknesses_nm"]) >= 1
    assert "superlattice" in body


def test_reflectivity_fft_route_xrr_missing_wavelength_422() -> None:
    resp = client.post(
        "/api/reductions/reflectivity-fft",
        json={"x": list(np.linspace(0.5, 6, 50)), "reflectivity": [1.0] * 50},
    )
    assert resp.status_code == 422


def test_spin_asymmetry_route() -> None:
    resp = client.post(
        "/api/reductions/spin-asymmetry",
        json={"r_pp": [0.9, 0.5, -0.1], "r_mm": [0.3, 0.5, 0.2]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_valid"] == 2
    assert body["asymmetry"][2] is None or math.isnan(body["asymmetry"][2])
