"""Integration tests for /api/fitting (TestClient). Math is golden in
test_calc_fitting; here we prove the transport: models list, autoguess, fit."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_list_models_has_linear_with_param_names() -> None:
    resp = client.get("/api/fitting/models")
    assert resp.status_code == 200
    models = resp.json()["models"]
    by_name = {m["name"]: m for m in models}
    assert "Linear" in by_name
    assert by_name["Linear"]["paramNames"] == ["m", "b"]
    assert by_name["Linear"]["nParams"] == 2


def test_autoguess_returns_param_vector() -> None:
    x = list(np.linspace(0, 10, 50))
    y = [2.0 * v + 1.0 for v in x]
    resp = client.post("/api/fitting/autoguess", json={"model": "Linear", "x": x, "y": y})
    assert resp.status_code == 200
    assert len(resp.json()["p0"]) == 2


def test_fit_linear_recovers_slope_intercept() -> None:
    x = list(np.linspace(0, 10, 50))
    y = [2.0 * v + 1.0 for v in x]
    resp = client.post(
        "/api/fitting/fit",
        json={"model": "Linear", "x": x, "y": y, "p0": [1.0, 0.0]},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["params"][0] - 2.0) < 1e-6
    assert abs(out["params"][1] - 1.0) < 1e-6
    assert out["R2"] > 0.9999
    assert len(out["yFit"]) == len(x)


def test_fit_autoguesses_when_p0_omitted() -> None:
    x = list(np.linspace(0, 10, 50))
    y = [2.0 * v + 1.0 for v in x]
    resp = client.post("/api/fitting/fit", json={"model": "Linear", "x": x, "y": y})
    assert resp.status_code == 200
    assert abs(resp.json()["params"][0] - 2.0) < 1e-6


def test_unknown_model_is_422() -> None:
    resp = client.post(
        "/api/fitting/fit", json={"model": "NoSuchModel", "x": [0, 1], "y": [0, 1]}
    )
    assert resp.status_code == 422
