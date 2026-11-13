"""``POST /api/fitting/report`` is a thin adapter over calc.fit_report.fit_report.

The response must equal the pure call on the same inputs (with ``dy`` turned
into ``1/dy**2`` weights exactly as ``/fit`` does), held parameters come back
with null inference columns, and bad input is a 422, never a 500.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.fit_report import fit_report

client = TestClient(app)


def _fit(
    dy: list[float] | None = None, fixed: list[bool] | None = None
) -> tuple[dict, list[float]]:
    x = np.linspace(0.0, 8.0, 50)
    y = (3.0 * np.exp(-x / 2.0) + 0.2 + 0.03 * np.sin(5.0 * x)).tolist()
    body: dict = {"model": "Exponential Decay", "x": x.tolist(), "y": y}
    if dy is not None:
        body["dy"] = dy
    if fixed is not None:
        body.update({"p0": [3.0, 2.0, 0.2], "fixed": fixed})
    resp = client.post("/api/fitting/fit", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json(), y


@pytest.mark.parametrize("weighted", [False, True])
def test_report_equals_calc(weighted: bool) -> None:
    dy = [0.05 + 0.001 * i for i in range(50)] if weighted else None
    fit, y = _fit(dy)
    req = {
        "params": fit["params"], "errors": fit["errors"], "covar": fit["covar"], "y": y,
        "residuals": fit["residuals"], "n_free": fit["nFree"], "level": 0.9,
        **({"dy": dy} if dy else {}),
    }
    resp = client.post("/api/fitting/report", json=req)
    assert resp.status_code == 200, resp.text
    got = resp.json()
    want = fit_report(
        fit["params"], fit["errors"], fit["covar"], y, fit["residuals"], fit["nFree"],
        weights=None if dy is None else [1.0 / d**2 for d in dy], level=0.9,
    )
    for g, w in zip(got["parameters"], want["parameters"], strict=True):
        assert g == pytest.approx(w)
    assert got["anova"] == want["anova"]
    assert got["stats"] == pytest.approx(want["stats"])
    assert got["level"] == 0.9
    assert len(got["correlation"]) == 3


def test_held_parameter_is_null_not_infinite() -> None:
    fit, y = _fit(fixed=[False, False, True])
    resp = client.post("/api/fitting/report", json={
        "params": fit["params"], "errors": fit["errors"], "covar": fit["covar"], "y": y,
        "residuals": fit["residuals"], "n_free": fit["nFree"],
    })
    assert resp.status_code == 200, resp.text
    held = resp.json()["parameters"][2]
    assert held["t"] is None and held["prob"] is None and held["lcl"] is None
    assert resp.json()["correlation"][2] == [None, None, None]


@pytest.mark.parametrize(
    "patch",
    [
        {"residuals": [0.1]},
        {"errors": [0.1]},
        {"level": 1.5},
        {"dy": [0.0, 1.0]},
        {"n_free": -1},
    ],
)
def test_bad_input_is_422(patch: dict) -> None:
    body = {"params": [1.0, 2.0], "errors": [0.1, 0.2], "y": [1.0, 2.0],
            "residuals": [0.01, -0.01], "n_free": 1, **patch}
    assert client.post("/api/fitting/report", json=body).status_code == 422


def test_direct_weights_equal_the_calc_and_exclude_with_dy() -> None:
    """Origin's direct weighting: the client posts the weights themselves
    (zero allowed), never as ``dy``."""
    fit, y = _fit()
    w = [0.0 if i % 7 == 0 else 1.0 + 0.1 * i for i in range(50)]
    req = {
        "params": fit["params"], "errors": fit["errors"], "covar": fit["covar"], "y": y,
        "residuals": fit["residuals"], "n_free": fit["nFree"], "weights": w,
    }
    resp = client.post("/api/fitting/report", json=req)
    assert resp.status_code == 200, resp.text
    want = fit_report(fit["params"], fit["errors"], fit["covar"], y, fit["residuals"],
                      fit["nFree"], weights=w)
    assert resp.json()["stats"]["n"] == want["stats"]["n"] == 42
    assert resp.json()["anova"][1]["ss"] == pytest.approx(want["anova"][1]["ss"])
    both = client.post("/api/fitting/report", json={**req, "dy": [0.1] * 50})
    assert both.status_code == 422
    neg = client.post("/api/fitting/report", json={**req, "weights": [-1.0] * 50})
    assert neg.status_code == 422
