"""Graded (spline) layers through POST /api/reflectivity/fit and /dream (S2).

Transport, cost accounting and refusals; the knot recovery itself is owned by
test_calc_refl_graded (no MATLAB counterpart: MATLAB has no reflectivity
fitter, so the synthetic round trip is the evidence).
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import profile_to_layers, spline_sld

client = TestClient(app)
KNOTS = [2.0e-6, 5.0e-6, 3.5e-6]


def _stack(knots: list[float], t: float = 100.0, slices: int = 50) -> np.ndarray:
    z, sld = spline_sld(np.linspace(0, t, len(knots)), knots, z_range=(0.0, t),
                        n_points=slices + 1)
    slabs = profile_to_layers(z, sld)[1:-1]
    slabs[0, 3] = 3.0
    return np.vstack([[0.0, 0.0, 0.0, 0.0], slabs, [0.0, 2.07e-6, 0.0, 3.0]])


def _body(**over: Any) -> dict[str, Any]:
    q = np.linspace(0.01, 0.22, 220)
    r = parratt_refl(q, _stack(KNOTS))
    start = [2.3e-6, 4.4e-6, 3.9e-6]
    body: dict[str, Any] = {
        "parameters": [
            {"name": "L0.sld", "value": 0.0},
            *({"name": f"L1.knot{j}.sld", "value": v, "vary": True, "min": 1e-6, "max": 7e-6}
              for j, v in enumerate(start)),
            {"name": "L1.thickness", "value": 100.0},
            {"name": "L1.roughness", "value": 3.0},
            {"name": "L2.sld", "value": 2.07e-6},
            {"name": "L2.roughness", "value": 3.0},
        ],
        "channels": [{"q": q.tolist(), "r": r.tolist(), "dr": (0.02 * r).tolist()}],
        "graded": [{"layer": 1, "method": "pchip", "slices": 50}],
    }
    body.update(over)
    return body


def _param(body: dict[str, Any], name: str, **edit: Any) -> dict[str, Any]:
    params = [{**p, **edit} if p["name"] == name else p for p in body["parameters"]]
    return {**body, "parameters": params}


def test_fit_route_fits_graded_knots() -> None:
    resp = client.post("/api/reflectivity/fit", json=_body())
    assert resp.status_code == 200, resp.text
    out = resp.json()
    got = {p["name"]: p["value"] for p in out["parameters"]}
    for j, k in enumerate(KNOTS):
        assert got[f"L1.knot{j}.sld"] == pytest.approx(k, rel=1e-3)
    assert out["free"] == ["L1.knot0.sld", "L1.knot1.sld", "L1.knot2.sld"]


@pytest.mark.parametrize(("body", "needle"), [
    (_body(graded=[]), "belongs to no graded layer"),
    (_body(graded=[{"layer": 1, "positions": [0.0, 0.7, 0.5]}]), "strictly increasing"),
    (_body(graded=[{"layer": 1, "positions": [0.0, 1.0]}]), "one position per knot"),
    (_param(_body(), "L1.knot1.sld", min=6e-6, max=2e-6), "finite min < max"),
    (_body(parameters=[p for p in _body()["parameters"] if p["name"] != "L1.knot1.sld"]),
     "without gaps"),
    (_body(parameters=[p for p in _body()["parameters"]
                       if p["name"] not in ("L1.knot1.sld", "L1.knot2.sld")]),
     "at least 2 knots"),
    (_body(graded=[{"layer": 1}, {"layer": 2}]), "film layer"),
])
def test_bad_graded_models_are_422_with_the_reason(body: dict[str, Any], needle: str) -> None:
    resp = client.post("/api/reflectivity/fit", json=body)
    assert resp.status_code == 422, resp.text
    assert needle in resp.text


def test_graded_slices_count_toward_the_evaluation_cap() -> None:
    # 20k points x (3 + 399) rows exceeds the 4M point-layer cap; the same
    # model as three slab layers does not.
    q = np.linspace(0.01, 0.2, 20_000)
    ch = [{"q": q.tolist(), "r": parratt_refl(q, _stack(KNOTS)).tolist(),
           "dr": (0.02 * parratt_refl(q, _stack(KNOTS))).tolist()}]
    body = _body(channels=ch, graded=[{"layer": 1, "slices": 400}])
    resp = client.post("/api/reflectivity/fit", json=body)
    assert resp.status_code == 422
    assert "point-layer evaluations" in resp.text


def test_dream_route_samples_graded_knots() -> None:
    fit = client.post("/api/reflectivity/fit", json=_body()).json()
    centre = {p["name"]: p["value"] for p in fit["parameters"] if p["vary"]}
    body = _body(centre=centre, samples=300, burn=10, pop=3, seed=2, band_draws=10)
    resp = client.post("/api/reflectivity/dream", json=body)
    assert resp.status_code == 200, resp.text
    job = resp.json()["job_id"]
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        snap = client.get(f"/api/jobs/{job}").json()
        if snap["status"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.05)
    assert snap["status"] == "done", snap
    out = client.get(f"/api/jobs/{job}/result").json()["result"]
    assert out["free"] == ["L1.knot0.sld", "L1.knot1.sld", "L1.knot2.sld"]
    # A graded refusal is a 422 before anything is queued.
    bad = client.post("/api/reflectivity/dream", json={**body, "graded": []})
    assert bad.status_code == 422
    assert "belongs to no graded layer" in bad.text
