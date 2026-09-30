"""Integration tests for POST /api/reflectivity/spline-sld (graded SLD layers).

``spline_sld`` and ``profile_to_layers`` are golden vs MATLAB in
test_calc_sld; here we prove the transport, that the route output matches the
calc functions called directly, and that bad knots are a 422, not a 500.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose

from quantized.app import app
from quantized.calc.sld import profile_to_layers, spline_sld

client = TestClient(app)

BODY: dict[str, Any] = {
    "z_knots": [0.0, 50.0, 100.0],
    "sld_knots": [2e-6, 5e-6, 3e-6],
    "method": "pchip",
    "z_range": [0.0, 100.0],
    "n_points": 51,
}


def test_spline_sld_matches_calc() -> None:
    resp = client.post("/api/reflectivity/spline-sld", json=BODY)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    z, sld = spline_sld(BODY["z_knots"], BODY["sld_knots"], z_range=(0.0, 100.0), n_points=51)
    assert_allclose(out["z"], z, rtol=1e-12)
    assert_allclose(out["sld"], sld, rtol=1e-12)
    assert_allclose(np.asarray(out["layers"]), profile_to_layers(z, sld), rtol=1e-12)


def test_spline_sld_layers_preserve_total_thickness() -> None:
    out = client.post("/api/reflectivity/spline-sld", json=BODY).json()
    layers = np.asarray(out["layers"])
    # ambient row, 50 midpoint slabs, substrate row; the slabs span z_range.
    assert layers.shape == (52, 4)
    assert_allclose(layers[1:-1, 0].sum(), 100.0, rtol=1e-12)


def test_spline_sld_ambient_and_substrate_overrides() -> None:
    body = {**BODY, "z_range": [-20.0, 120.0], "sld_ambient": 0.0, "sld_substrate": 2.07e-6}
    out = client.post("/api/reflectivity/spline-sld", json=body).json()
    assert out["sld"][0] == 0.0
    assert out["sld"][-1] == 2.07e-6


def test_spline_sld_rejects_non_increasing_knots() -> None:
    body = {**BODY, "z_knots": [0.0, 60.0, 50.0]}
    resp = client.post("/api/reflectivity/spline-sld", json=body)
    assert resp.status_code == 422


def test_spline_sld_rejects_mismatched_knots() -> None:
    body = {**BODY, "sld_knots": [2e-6, 5e-6]}
    resp = client.post("/api/reflectivity/spline-sld", json=body)
    assert resp.status_code == 422


def test_spline_sld_rejects_unknown_method() -> None:
    resp = client.post("/api/reflectivity/spline-sld", json={**BODY, "method": "cubic"})
    assert resp.status_code == 422


def test_spline_sld_rejects_empty_range() -> None:
    resp = client.post("/api/reflectivity/spline-sld", json={**BODY, "z_range": [100.0, 0.0]})
    assert resp.status_code == 422
