"""POST /api/fitting/standard-curve: a thin pass-through to calc.standard_curve."""

from __future__ import annotations

import math

import numpy as np
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose

from quantized.app import app
from quantized.calc.standard_curve import standard_curve

client = TestClient(app)
X = [0.0, 1.0, 2.0, 4.0, 8.0, 16.0]
Y = [0.05, 0.31, 0.58, 1.09, 2.17, 4.28]


def test_the_route_returns_the_calc_result() -> None:
    body = {"x": X, "y": Y, "unknowns": [0.2, 1.4], "model": "linear", "replicates": 2}
    r = client.post("/api/fitting/standard-curve", json=body)
    assert r.status_code == 200
    out = r.json()
    want = standard_curve(X, Y, [0.2, 1.4], model="linear", replicates=2)
    assert_allclose(out["params"], want["params"])
    assert out["paramNames"] == ["a", "b"] and out["dof"] == 4
    for got, ref in zip(out["unknowns"], want["unknowns"], strict=True):
        keys = ("x", "lower", "upper")
        assert_allclose([got[k] for k in keys], [ref[k] for k in keys])
        assert got["status"] == "ok"
    slope = np.polyfit(X, Y, 1)[0]
    assert math.isclose(out["params"][1], slope, rel_tol=1e-6)


def test_an_off_curve_response_is_a_result_not_an_error() -> None:
    xs = [0.5, 1, 2, 5, 10, 20, 50, 100, 200]
    ys = [
        0.05 + 2.35 * (1 - 1 / (1 + (v / 25.0) ** 1.3)) + 0.01 * (-1) ** i
        for i, v in enumerate(xs)
    ]
    body = {"x": xs, "y": ys, "unknowns": [9.0], "model": "4pl"}
    r = client.post("/api/fitting/standard-curve", json=body)
    assert r.status_code == 200
    u = r.json()["unknowns"][0]
    assert u["x"] is None and u["status"] == "outside curve"


def test_unfittable_standards_are_a_422() -> None:
    tiny = {"x": [0, 1], "y": [0, 1], "unknowns": [1]}
    r = client.post("/api/fitting/standard-curve", json=tiny)
    assert r.status_code == 422 and "needs more than" in r.json()["detail"]
    base = {"x": X, "y": Y, "unknowns": [1]}
    for bad in ({"model": "cubic"}, {"replicates": 0}, {"confidence": 2}):
        r = client.post("/api/fitting/standard-curve", json={**base, **bad})
        assert r.status_code == 422


def test_non_finite_input_is_refused_not_a_500() -> None:
    r = client.post("/api/fitting/standard-curve",
                    content='{"x":[0,1,2,3],"y":[0,NaN,2,3],"unknowns":[1]}',
                    headers={"content-type": "application/json"})
    assert r.status_code in (400, 422)
