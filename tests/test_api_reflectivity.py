"""Integration tests for /api/reflectivity (TestClient). The Parratt recursion
and SLD helpers are golden in test_calc_reflectivity / test_calc_sld; here we
prove the transport and that the route output matches the calc functions called
directly (no serialization drift)."""

from __future__ import annotations

from typing import Any

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


# ── /fit (audit P2.2) ─────────────────────────────────────────────────────────


def _fit_body(**over: Any) -> dict[str, Any]:
    q = np.linspace(0.01, 0.2, 200)
    r = parratt_refl(q, LAYERS)
    body = {
        "parameters": [
            {"name": "L0.sld", "value": 0.0},
            {"name": "L1.thickness", "value": 190.0, "vary": True, "min": 150.0, "max": 250.0},
            {"name": "L1.sld", "value": 4e-6},
            {"name": "L1.roughness", "value": 5.0},
            {"name": "L2.sld", "value": 2.07e-6},
            {"name": "L2.roughness", "value": 3.0},
        ],
        "channels": [{"q": q.tolist(), "r": r.tolist(), "dr": (0.02 * r).tolist()}],
    }
    body.update(over)
    return body


def test_fit_recovers_thickness_and_serializes() -> None:
    resp = client.post("/api/reflectivity/fit", json=_fit_body())
    assert resp.status_code == 200, resp.text
    out = resp.json()
    p = {x["name"]: x for x in out["parameters"]}
    assert abs(p["L1.thickness"]["value"] - 200.0) < 0.01
    assert out["free"] == ["L1.thickness"]
    assert len(out["curves"][0]["model"]) == 200
    assert out["sld_profiles"][0]["spin"] is None


def test_fit_rejects_unknown_tie_and_bad_weighting() -> None:
    body = _fit_body()
    body["parameters"][3]["tie"] = "L9.sld"
    resp = client.post("/api/reflectivity/fit", json=body)
    assert resp.status_code == 422 and "unknown parameter" in resp.json()["detail"]
    assert client.post("/api/reflectivity/fit", json=_fit_body(weighting="chi")).status_code == 422


def test_fit_rejects_non_finite_and_oversized_input() -> None:
    body = _fit_body()
    body["channels"][0]["spin"] = "x"
    assert client.post("/api/reflectivity/fit", json=body).status_code == 422
    body = _fit_body()
    body["channels"] = body["channels"] * 5
    assert client.post("/api/reflectivity/fit", json=body).status_code == 422


def test_simulate_treats_positive_sld_imag_as_absorption() -> None:
    # BUG-029: the golden engine treats +imag as gain; the route's contract is
    # the presets' (positive = absorption), so a thick absorbing film must
    # reflect less than a clear one.
    def r_at(imag: float) -> float:
        layers = [[0.0, 0.0, 0.0, 0.0], [2000.0, 4e-6, imag, 0.0], [0.0, 2.07e-6, 0.0, 0.0]]
        body = {"layers": layers, "q_min": 0.02, "q_max": 0.021, "n_points": 2}
        return float(client.post("/api/reflectivity/simulate", json=body).json()["r"][0])

    assert r_at(0.5e-6) < r_at(0.0)


def test_fit_refuses_a_request_too_costly_to_evaluate() -> None:
    body = _fit_body()
    n = 20_000
    q = np.linspace(0.01, 0.2, n).tolist()
    body["channels"] = [{"q": q, "r": [1.0] * n, "dr": [0.1] * n, "resolution": 0.02}] * 4
    resp = client.post("/api/reflectivity/fit", json=body)
    assert resp.status_code == 422
    assert "point-layer evaluations" in resp.json()["detail"]
