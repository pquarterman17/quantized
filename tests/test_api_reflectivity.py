"""Integration tests for /api/reflectivity (TestClient). The Parratt recursion
and SLD helpers are golden in test_calc_reflectivity / test_calc_sld; here we
prove the transport and that the route output matches the calc functions called
directly (no serialization drift)."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose

from quantized.app import app
from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import sld_profile

client = TestClient(app)

# vacuum / 200 Å film (SLD 4e-6) / Si substrate (SLD 2.07e-6); roughnesses in Å.
LAYERS = [[0.0, 0.0, 0.0, 0.0], [200.0, 4e-6, 0.0, 5.0], [0.0, 2.07e-6, 0.0, 3.0]]


def test_simulate_matches_calc() -> None:
    body = {"layers": LAYERS, "q_min": 0.01, "q_max": 0.3, "n_points": 256}
    resp = client.post("/api/reflectivity/simulate", json=body)
    assert resp.status_code == 200
    out = resp.json()
    q = np.linspace(0.01, 0.3, 256)
    r_expected = parratt_refl(q, LAYERS)
    assert_allclose(out["q"], q, rtol=1e-12)
    assert_allclose(out["r"], r_expected, rtol=1e-9, atol=1e-12)
    assert len(out["r"]) == 256


def test_simulate_scale_background_resolution() -> None:
    body = {
        "layers": LAYERS,
        "q_min": 0.02,
        "q_max": 0.25,
        "n_points": 64,
        "scale": 2.0,
        "background": 1e-6,
        "resolution": 0.03,
    }
    out = client.post("/api/reflectivity/simulate", json=body).json()
    q = np.linspace(0.02, 0.25, 64)
    r_expected = parratt_refl(q, LAYERS, scale=2.0, background=1e-6, resolution=0.03)
    assert_allclose(out["r"], r_expected, rtol=1e-9, atol=1e-12)


def test_simulate_rejects_bad_q_range() -> None:
    body = {"layers": LAYERS, "q_min": 0.3, "q_max": 0.1}
    resp = client.post("/api/reflectivity/simulate", json=body)
    assert resp.status_code == 422


def test_simulate_rejects_malformed_layer() -> None:
    body = {"layers": [[0.0, 0.0, 0.0], [200.0, 4e-6, 0.0, 5.0]]}  # first row len 3
    resp = client.post("/api/reflectivity/simulate", json=body)
    assert resp.status_code == 422


def test_simulate_rejects_single_layer() -> None:
    # Pydantic min_length=2 on layers -> 422 before reaching calc.
    resp = client.post("/api/reflectivity/simulate", json={"layers": [[0, 0, 0, 0]]})
    assert resp.status_code == 422


def test_sld_profile_matches_calc() -> None:
    out = client.post(
        "/api/reflectivity/sld-profile",
        json={"layers": LAYERS, "n_points": 300, "padding": 40.0},
    ).json()
    z, sld = sld_profile(LAYERS, n_points=300, padding=40.0)
    assert_allclose(out["z"], z, rtol=1e-12)
    assert_allclose(out["sld"], sld, rtol=1e-9, atol=1e-15)


def test_presets_nonempty_and_shaped() -> None:
    out = client.get("/api/reflectivity/presets").json()
    presets = out["presets"]
    assert isinstance(presets, list)
    assert len(presets) > 10
    si = next(p for p in presets if p["formula"] == "Si")
    assert si["name"] == "Silicon"
    assert set(si) >= {"name", "formula", "sldX", "sldN", "sldImag", "density"}
