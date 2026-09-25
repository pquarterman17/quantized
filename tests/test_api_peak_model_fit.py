"""/api/peaks/model-fit (TestClient). The fitter is verified in
test_calc_peak_model_fit; here we prove the transport: the route returns what
the calc function returns (no serialization drift), null rows are dropped,
bad input is a 422 with ASCII text, and the deadline is capped."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.peak_model_fit import fit_peak_model
from quantized.routes.peaks import MODEL_FIT_MAX_DEADLINE_S

client = TestClient(app)

X = np.linspace(-5.0, 5.0, 201)
Y = (30 * np.exp(-4 * np.log(2) * (X + 1) ** 2) + 20 / (1 + 4 * (X - 1.5) ** 2 / 0.64)
     + 2.0 + 0.3 * np.random.default_rng(0).normal(size=X.size))


def _body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "x": X.tolist(), "y": Y.tolist(),
        "shapes": ["gaussian", "lorentzian"], "background": "constant",
        "parameters": [
            {"name": "p0.center", "value": -0.8, "vary": True},
            {"name": "p0.height", "value": 25.0, "vary": True},
            {"name": "p0.fwhm", "value": 1.2, "vary": True, "min": 0.1, "max": 5.0},
            {"name": "p1.center", "value": 1.3, "vary": True},
            {"name": "p1.height", "value": 15.0, "vary": True},
            {"name": "p1.fwhm", "value": 1.0, "vary": True},
            {"name": "bg.c0", "value": 0.0, "vary": True},
        ],
    }
    body.update(over)
    return body


def test_model_fit_matches_the_calc_function() -> None:
    resp = client.post("/api/peaks/model-fit", json=_body())
    assert resp.status_code == 200
    out = resp.json()
    direct = fit_peak_model(X, Y, ["gaussian", "lorentzian"], _body()["parameters"],
                            background="constant", deadline_s=10.0)
    assert out["success"] and out["warnings"] == direct["warnings"] == []
    for a, b in zip(out["parameters"], direct["parameters"], strict=True):
        assert a["name"] == b["name"]
        assert a["value"] == pytest.approx(b["value"], rel=1e-12)
        assert a["stderr"] == pytest.approx(b["stderr"], rel=1e-9)
    assert out["peaks"][1]["area"] == pytest.approx(direct["peaks"][1]["area"], rel=1e-12)
    assert out["peaks"][1]["fwhm"] == pytest.approx(0.8, abs=0.05)
    assert out["metrics"]["objective"] == "ssr" and out["metrics"]["chi2"] is None
    assert len(out["curves"]["components"]) == 2
    assert out["background"] == {"kind": "constant", "x_ref": pytest.approx(0.0)}


def test_null_rows_are_dropped_and_counted() -> None:
    y: list[float | None] = Y.tolist()
    y[100] = None
    y[101] = None
    resp = client.post("/api/peaks/model-fit", json=_body(y=y, x_min=-4.0))
    assert resp.status_code == 200
    out = resp.json()
    assert out["n_dropped"] == 2
    assert out["metrics"]["n_points"] == int((X >= -4.0).sum()) - 2
    assert out["n_excluded"] == int((X < -4.0).sum())
    assert out["x_range"][0] >= -4.0


def test_weighted_fit_reports_chi2() -> None:
    resp = client.post("/api/peaks/model-fit", json=_body(y_err=[0.3] * X.size))
    out = resp.json()
    assert resp.status_code == 200 and out["weighted"]
    assert out["metrics"]["objective"] == "chi2"
    assert out["metrics"]["reduced_chi2"] == pytest.approx(1.0, abs=0.3)


@pytest.mark.parametrize(("over", "needle"), [
    ({"parameters": [{"name": "p0.center", "value": 0.0}]}, "missing parameters"),
    ({"shapes": ["gaussian", "gaussian", "gaussian"]}, "missing parameters"),
    ({"y_err": [0.0] * X.size}, "y_err must be positive"),
    ({"x_min": 3.0, "x_max": 1.0}, "x_min must be less than x_max"),
])
def test_bad_model_is_a_422_with_ascii_detail(over: dict[str, Any], needle: str) -> None:
    resp = client.post("/api/peaks/model-fit", json=_body(**over))
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, str) and detail.isascii() and needle in detail


def test_tie_errors_are_422() -> None:
    body = _body()
    body["parameters"][5]["tie"] = "p0.height"
    resp = client.post("/api/peaks/model-fit", json=body)
    assert resp.status_code == 422
    assert "one kind" in resp.json()["detail"] and resp.json()["detail"].isascii()


@pytest.mark.parametrize("over", [
    {"shapes": ["cauchy"]},
    {"background": "cubic"},
    {"deadline_s": MODEL_FIT_MAX_DEADLINE_S + 1},
    {"deadline_s": 0},
    {"max_nfev": 0},
    {"parameters": [{"name": "p².center", "value": 0.0}]},
])
def test_schema_violations_are_422(over: dict[str, Any]) -> None:
    assert client.post("/api/peaks/model-fit", json=_body(**over)).status_code == 422


def test_route_deadline_returns_a_flagged_best_point() -> None:
    # The smallest allowed budget still stops a fit of many points and peaks.
    x = np.linspace(0, 100, 20_000)
    shapes = ["voigt"] * 10
    params = []
    for i in range(10):
        params += [{"name": f"p{i}.center", "value": 10.0 * i + 5, "vary": True},
                   {"name": f"p{i}.height", "value": 1.0, "vary": True},
                   {"name": f"p{i}.fwhm_g", "value": 0.5, "vary": True},
                   {"name": f"p{i}.fwhm_l", "value": 0.5, "vary": True}]
    body = {"x": x.tolist(), "y": np.sin(x).tolist(), "shapes": shapes,
            "background": "none", "parameters": params, "deadline_s": 0.05}
    resp = client.post("/api/peaks/model-fit", json=body)
    assert resp.status_code == 200
    out = resp.json()
    assert not out["success"] and "time limit" in out["message"]
    assert all(p["stderr"] is None for p in out["parameters"])
