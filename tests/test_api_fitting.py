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


def _outlier_linear() -> tuple[list[float], list[float]]:
    """y = 2x + 1 on 0..10 with a single big outlier on the last point."""
    x = list(np.linspace(0.0, 10.0, 11))
    y = [2.0 * v + 1.0 for v in x]
    y[-1] += 50.0  # corrupt the last point
    return x, y


def test_fit_dy_downweights_outlier() -> None:
    """Weighting engages: a large dy on the outlier pulls the slope back toward
    the true value, closer than the unweighted fit that the outlier drags up."""
    x, y = _outlier_linear()
    unweighted = client.post(
        "/api/fitting/fit", json={"model": "Linear", "x": x, "y": y, "p0": [1.0, 0.0]}
    ).json()
    dy = [1.0] * len(x)
    dy[-1] = 1000.0  # down-weight the corrupted point
    weighted = client.post(
        "/api/fitting/fit",
        json={"model": "Linear", "x": x, "y": y, "p0": [1.0, 0.0], "dy": dy},
    ).json()
    # Unweighted slope is dragged well above 2; weighted recovers ~2.
    assert abs(weighted["params"][0] - 2.0) < 0.05
    assert abs(weighted["params"][0] - 2.0) < abs(unweighted["params"][0] - 2.0)


def test_fit_dy_takes_precedence_over_weights() -> None:
    """When both are sent, dy (1/dy^2) wins over the legacy raw weights vector."""
    x, y = _outlier_linear()
    dy = [1.0] * len(x)
    dy[-1] = 1000.0
    dy_only = client.post(
        "/api/fitting/fit",
        json={"model": "Linear", "x": x, "y": y, "p0": [1.0, 0.0], "dy": dy},
    ).json()
    both = client.post(
        "/api/fitting/fit",
        json={
            "model": "Linear",
            "x": x,
            "y": y,
            "p0": [1.0, 0.0],
            "dy": dy,
            "weights": [1.0] * len(x),  # contradictory raw weights, must be ignored
        },
    ).json()
    assert both["params"] == dy_only["params"]


def test_fit_dy_wrong_length_is_422() -> None:
    x, y = _outlier_linear()
    resp = client.post(
        "/api/fitting/fit",
        json={"model": "Linear", "x": x, "y": y, "dy": [1.0, 1.0]},
    )
    assert resp.status_code == 422


def test_fit_dy_nonpositive_is_422() -> None:
    x, y = _outlier_linear()
    dy = [1.0] * len(x)
    dy[3] = 0.0  # a zero error would demand infinite weight
    resp = client.post(
        "/api/fitting/fit",
        json={"model": "Linear", "x": x, "y": y, "dy": dy},
    )
    assert resp.status_code == 422


def test_bootstrap_roundtrip() -> None:
    import numpy as np

    x = list(np.linspace(0, 5, 40))
    y = [1.0 + 2.0 * v + 0.05 * float(np.sin(31.0 * v)) for v in x]
    resp = client.post(
        "/api/fitting/bootstrap",
        json={"model": "Linear", "x": x, "y": y, "p0": [0.5, 1.0], "n_boot": 60, "seed": 2},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["ciLow"][0] <= 2.0 <= out["ciHigh"][0]  # Linear params are [m, b]
    assert out["n_boot"] >= 30


def test_bootstrap_return_samples_flag() -> None:
    """return_samples (gap #29) is opt-in and off by default; when set it
    threads through to boot_samples, the corner-plot export's input."""
    x = list(np.linspace(0, 5, 40))
    y = [1.0 + 2.0 * v + 0.05 * float(np.sin(31.0 * v)) for v in x]
    body = {"model": "Linear", "x": x, "y": y, "p0": [0.5, 1.0], "n_boot": 60, "seed": 2}

    off = client.post("/api/fitting/bootstrap", json=body)
    assert off.status_code == 200
    assert "boot_samples" not in off.json()

    on = client.post("/api/fitting/bootstrap", json={**body, "return_samples": True})
    assert on.status_code == 200
    out = on.json()
    assert "boot_samples" in out
    assert len(out["boot_samples"]) == out["n_boot"]
    assert len(out["boot_samples"][0]) == 2  # Linear has 2 params
