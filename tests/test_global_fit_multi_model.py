"""Global fit with one model per dataset (Origin multi-output models, plan item 12).

``y1 = A*exp(-x/tau)`` and ``y2 = B*(1 - exp(-x/tau))`` share ``tau``. The joint
fit is pinned against ``scipy.optimize.least_squares`` on a hand-built stacked
residual, and its AIC / BIC against ``calc.fit_metrics`` on that residual.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from scipy.optimize import least_squares

from quantized.app import app
from quantized.calc.fit_metrics import fit_metrics

client = TestClient(app)
URL = "/api/fitting/global"
EQ1 = "y = A*exp(-x/tau)"
EQ2 = "y = B*(1-exp(-x/tau))"
TRUE = {"A": 4.0, "B": 2.5, "tau": 3.0}


def _data() -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    rng = np.random.default_rng(7)
    x = np.linspace(0.0, 12.0, 50)
    y1 = TRUE["A"] * np.exp(-x / TRUE["tau"]) + rng.normal(0, 0.03, x.size)
    y2 = TRUE["B"] * (1 - np.exp(-x / TRUE["tau"])) + rng.normal(0, 0.03, x.size)
    return x, y1, y2


Arr = NDArray[np.float64]


def _request(x: Arr, y1: Arr, y2: Arr) -> dict[str, Any]:
    return {
        "datasets": [{"x": x.tolist(), "y": y1.tolist()}, {"x": x.tolist(), "y": y2.tolist()}],
        "dataset_models": [
            {"equation": EQ1, "p0": [1.0, 1.0]},
            {"equation": EQ2, "p0": [1.0, 1.0]},
        ],
        "constraints": [{"param_name": "tau", "datasets": [0, 1]}],
    }


def _oracle(x: Arr, y1: Arr, y2: Arr) -> dict[str, Any]:
    def resid(p: NDArray[np.float64]) -> NDArray[np.float64]:
        a, b, tau = p
        return np.concatenate([y1 - a * np.exp(-x / tau), y2 - b * (1 - np.exp(-x / tau))])

    sol = least_squares(resid, [1.0, 1.0, 1.0], xtol=1e-14, ftol=1e-14, gtol=1e-14)
    r = resid(sol.x)
    s2 = float(r @ r) / (r.size - 3)
    se = np.sqrt(np.diag(np.linalg.inv(sol.jac.T @ sol.jac)) * s2)
    return {"p": sol.x, "se": se, "metrics": fit_metrics(r, 3)}


def test_two_models_one_shared_parameter_match_scipy_stacked_residual() -> None:
    x, y1, y2 = _data()
    res = client.post(URL, json=_request(x, y1, y2))
    assert res.status_code == 200, res.text
    out = res.json()
    ref = _oracle(x, y1, y2)
    a, b, tau = ref["p"]

    assert out["paramNames"] == ["A", "tau", "B"]
    assert out["datasetParamNames"] == [["A", "tau"], ["B", "tau"]]
    # dataset 0 owns (A, tau); dataset 1 owns (B, tau); absent slots are null on the wire.
    np.testing.assert_allclose([out["params"][0][0], out["params"][0][1]], [a, tau], rtol=1e-5)
    np.testing.assert_allclose([out["params"][1][1], out["params"][1][2]], [tau, b], rtol=1e-5)
    assert out["params"][0][2] is None and out["params"][1][0] is None
    # Shared tau appears ONCE with one standard error.
    assert [s["name"] for s in out["shared"]] == ["tau"]
    np.testing.assert_allclose(out["shared"][0]["value"], tau, rtol=1e-5)
    np.testing.assert_allclose(out["shared"][0]["error"], ref["se"][2], rtol=1e-3)
    np.testing.assert_allclose(out["errors"][0][0], ref["se"][0], rtol=1e-3)
    np.testing.assert_allclose(out["errors"][1][2], ref["se"][1], rtol=1e-3)
    # Parameters recover the generating values (noise 0.03).
    np.testing.assert_allclose([a, b, tau], [TRUE["A"], TRUE["B"], TRUE["tau"]], rtol=0.02)
    # Joint statistics follow calc.fit_metrics.
    m = ref["metrics"]
    assert out["nTotal"] == 100 and out["nFree"] == 3
    for key in ("AIC", "AICc", "BIC"):
        np.testing.assert_allclose(out[key], m[key], rtol=1e-6)
    np.testing.assert_allclose(out["chiSqTotal"], m["chiSq"], rtol=1e-6)
    np.testing.assert_allclose(out["chiSqRed"], m["chiSqRed"], rtol=1e-6)


def test_same_name_in_two_models_is_not_shared_unless_marked() -> None:
    x, y1, y2 = _data()
    req = _request(x, y1, y2)
    req["constraints"] = []
    out = client.post(URL, json=req).json()
    assert out["shared"] == []
    assert out["nFree"] == 4  # A, tau (ds 0), tau, B (ds 1)
    # Each dataset fitted on its own: tau agrees with a separate scipy fit of that dataset.
    sol = least_squares(lambda p: y1 - p[0] * np.exp(-x / p[1]), [1.0, 1.0], xtol=1e-14, ftol=1e-14)
    np.testing.assert_allclose(out["params"][0][:2], sol.x, rtol=1e-4)


def test_share_refused_when_a_model_lacks_the_parameter() -> None:
    x, y1, y2 = _data()
    req = _request(x, y1, y2)
    req["constraints"] = [{"param_name": "A", "datasets": [0, 1]}]
    res = client.post(URL, json=req)
    assert res.status_code == 422
    assert 'cannot share "A"' in res.json()["detail"]
    assert "dataset 1" in res.json()["detail"]
    req["constraints"] = [{"param_name": "nope", "datasets": [0, 1]}]
    assert client.post(URL, json=req).status_code == 422


def test_per_dataset_models_request_validation() -> None:
    x, y1, y2 = _data()
    req = _request(x, y1, y2)
    short = {**req, "dataset_models": req["dataset_models"][:1]}
    assert client.post(URL, json=short).status_code == 422
    assert client.post(URL, json={**req, "model": "Linear"}).status_code == 422
    assert client.post(URL, json={**req, "p0": [1.0]}).status_code == 422
    first = {"equation": EQ1, "model": "Linear"}
    both = {**req, "dataset_models": [first, req["dataset_models"][1]]}
    assert client.post(URL, json=both).status_code == 422
    assert client.post("/api/fitting/compare-datasets", json=req).status_code == 422


def test_registry_models_default_to_autoguess_and_job_route_runs() -> None:
    x = np.linspace(0.0, 10.0, 60)
    y1 = 5.0 * np.exp(-x / 2.5) + 0.5
    y2 = 3.0 * np.exp(-x / 2.5) + 0.2 + 0.1 * x
    req = {
        "datasets": [{"x": x.tolist(), "y": y1.tolist()}, {"x": x.tolist(), "y": y2.tolist()}],
        "dataset_models": [{"model": "Exponential Decay"}, {"model": "Exponential Decay"}],
        "constraints": [{"param_name": "τ", "datasets": [0, 1]}],
    }
    res = client.post(URL, json=req)
    assert res.status_code == 200, res.text
    assert res.json()["datasetModels"] == ["Exponential Decay", "Exponential Decay"]
    job = client.post(URL + "/job", json=req)
    assert job.status_code == 200 and "job_id" in job.json()


def test_single_model_result_now_carries_joint_statistics() -> None:
    x = np.linspace(0.0, 10.0, 40)
    rng = np.random.default_rng(3)
    ys = [a * np.exp(-x / 2.0) + rng.normal(0, 0.02, x.size) for a in (3.0, 5.0)]
    res = client.post(URL, json={
        "equation": "y = A*exp(-x/tau)",
        "datasets": [{"x": x.tolist(), "y": y.tolist()} for y in ys],
        "constraints": [{"param_name": "tau", "datasets": [0, 1]}],
        "p0": [1.0, 1.0],
    }).json()
    resid = np.concatenate([
        y - p[0] * np.exp(-x / p[1]) for y, p in zip(ys, res["params"], strict=True)
    ])
    m = fit_metrics(resid, res["nFree"])
    np.testing.assert_allclose([res["AIC"], res["BIC"]], [m["AIC"], m["BIC"]], rtol=1e-6)


@pytest.mark.parametrize("bad", [0, 2])
def test_constraint_dataset_out_of_range(bad: int) -> None:
    x, y1, y2 = _data()
    req = _request(x, y1, y2)
    req["constraints"] = [{"param_name": "tau", "datasets": [0, bad + 1 if bad else -1]}]
    assert client.post(URL, json=req).status_code == 422
