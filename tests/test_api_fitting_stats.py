"""Integration tests for the fit-statistics routes (routes/fitting_stats.py).

Each route is a thin adapter: the response must equal the pure calc call on
the same inputs (bands -> calc.fit_stats.fit_bands, diagnostics ->
fit_compare + residual_diagnostics, compare -> calc.fit_model_compare,
odr -> calc.fit_odr.odr_fit). Bad input is a 422, never a 500, and
non-finite values serialize as null.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.fit_equation import equation_model
from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fit_odr import odr_fit
from quantized.calc.fit_stats import fit_bands, fit_compare, residual_diagnostics

client = TestClient(app)


def _gauss_fit() -> tuple[dict[str, Any], list[float], list[float]]:
    x = np.linspace(0.0, 20.0, 80)
    y = 5.0 * np.exp(-((x - 10.0) ** 2) / (2 * 1.4**2)) + 0.05 * np.sin(3.0 * x)
    resp = client.post(
        "/api/fitting/fit", json={"model": "Gaussian", "x": x.tolist(), "y": y.tolist()}
    )
    assert resp.status_code == 200
    return resp.json(), x.tolist(), y.tolist()


def _approx_list(got: list[float | None], want: np.ndarray) -> None:
    assert got == pytest.approx(want.tolist(), rel=1e-12, abs=1e-12)


# ── /bands ───────────────────────────────────────────────────────────────────


def test_bands_match_calc_for_a_registry_model() -> None:
    fit, x, _ = _gauss_fit()
    grid = np.linspace(0.0, 20.0, 50)
    dof = fit["nPoints"] - fit["nFree"]
    resp = client.post(
        "/api/fitting/bands",
        json={
            "model": "Gaussian", "params": fit["params"], "covar": fit["covar"],
            "x": grid.tolist(), "n_points": fit["nPoints"], "dof": dof, "level": 0.9,
        },
    )
    assert resp.status_code == 200
    out = resp.json()
    want = fit_bands(
        grid, FIT_MODELS["Gaussian"]["fcn"], fit["params"], fit["covar"],
        fit["nPoints"], dof, level=0.9,
    )
    for key in ("yFit", "ciLo", "ciHi", "piLo", "piHi"):
        _approx_list(out[key], want[key])
    assert out["level"] == 0.9
    ci_lo, ci_hi = np.array(out["ciLo"]), np.array(out["ciHi"])
    pi_lo, pi_hi = np.array(out["piLo"]), np.array(out["piHi"])
    assert np.all(ci_lo <= ci_hi) and np.all(pi_lo <= ci_lo) and np.all(ci_hi <= pi_hi)
    assert len(x) == 80


def test_bands_accept_a_custom_equation() -> None:
    x = np.linspace(0.0, 5.0, 30)
    y = 2.0 * x + 1.0 + 0.1 * np.cos(4 * x)
    fit = client.post(
        "/api/fitting/equation/fit",
        json={"equation": "a*x + b", "x": x.tolist(), "y": y.tolist()},
    ).json()
    resp = client.post(
        "/api/fitting/bands",
        json={"equation": "a*x + b", "params": fit["params"], "covar": fit["covar"],
              "x": x.tolist(), "n_points": 30, "dof": 28},
    )
    assert resp.status_code == 200
    fcn, _ = equation_model("a*x + b")
    want = fit_bands(x, fcn, fit["params"], fit["covar"], 30, 28)
    _approx_list(resp.json()["ciHi"], want["ciHi"])
    assert resp.json()["level"] == 0.95


def test_bands_without_covariance_come_back_null_not_500() -> None:
    resp = client.post(
        "/api/fitting/bands",
        json={"model": "Linear", "params": [1.0, 0.0], "covar": None,
              "x": [0.0, 1.0, 2.0], "n_points": 3, "dof": 1},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["yFit"] == [0.0, 1.0, 2.0]
    assert out["ciLo"] == [None, None, None]


@pytest.mark.parametrize(
    "body",
    [
        {"params": [1.0, 0.0]},  # neither model nor equation
        {"model": "Linear", "equation": "a*x", "params": [1.0, 0.0]},  # both
        {"model": "No Such", "params": [1.0]},
        {"equation": "a*x + b", "params": [1.0]},  # wrong param count
        {"model": "Linear", "params": [1.0, 0.0], "level": 1.5},
        {"model": "Linear", "params": [1.0, 0.0], "level": 0.0},
    ],
)
def test_bands_bad_input_is_422(body: dict[str, Any]) -> None:
    base = {"x": [0.0, 1.0, 2.0], "covar": None, "n_points": 3, "dof": 1}
    resp = client.post("/api/fitting/bands", json={**base, **body})
    assert resp.status_code == 422


# ── /diagnostics ─────────────────────────────────────────────────────────────


def test_diagnostics_match_calc() -> None:
    fit, _, y = _gauss_fit()
    resp = client.post(
        "/api/fitting/diagnostics",
        json={"y": y, "residuals": fit["residuals"], "n_params": fit["nFree"]},
    )
    assert resp.status_code == 200
    out = resp.json()
    cmp_ = fit_compare(y, fit["residuals"], fit["nFree"])
    diag = residual_diagnostics(fit["residuals"])
    for key in ("R2", "adjR2", "aic", "aicc", "bic", "rmse"):
        assert out["compare"][key] == pytest.approx(cmp_[key], rel=1e-12)
    for key in ("durbinWatson", "runsTestZ", "runsTestP", "skewness", "kurtosis"):
        assert out["residuals"][key] == pytest.approx(diag[key], rel=1e-12)
    assert out["residuals"]["nRuns"] == diag["nRuns"]
    _approx_list(out["residuals"]["qqX"], diag["qqX"])


def test_diagnostics_tiny_input_serializes_nan_as_null() -> None:
    resp = client.post(
        "/api/fitting/diagnostics", json={"y": [1.0, 2.0], "residuals": [0.1, -0.1], "n_params": 1}
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["residuals"]["durbinWatson"] is None
    assert out["compare"]["fStat"] is None


def test_diagnostics_length_mismatch_is_422() -> None:
    resp = client.post(
        "/api/fitting/diagnostics", json={"y": [1.0, 2.0, 3.0], "residuals": [0.1], "n_params": 1}
    )
    assert resp.status_code == 422


# ── /compare ─────────────────────────────────────────────────────────────────


def test_compare_ranks_and_f_tests_against_the_reference() -> None:
    x = np.linspace(-3.0, 3.0, 61)
    y = 0.8 * x**2 - 0.5 * x + 1.0 + 0.05 * np.sin(11.0 * x)
    resp = client.post(
        "/api/fitting/compare",
        json={"x": x.tolist(), "y": y.tolist(), "models": ["Linear", "Quadratic"]},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["reference"] == "Linear"
    lin, quad = out["results"]
    assert quad["dAIC"] == 0.0 and lin["dAIC"] > 10.0
    assert lin["fStat"] is None  # the reference has no F-test against itself
    assert quad["fPvalue"] < 1e-6


def test_compare_needs_two_candidates() -> None:
    body = {"x": [0, 1, 2, 3], "y": [0, 1, 2, 3], "models": ["Linear"]}
    resp = client.post("/api/fitting/compare", json=body)
    assert resp.status_code == 422


# ── /odr ─────────────────────────────────────────────────────────────────────


def test_odr_matches_calc_and_derives_lambda_from_errors() -> None:
    x = np.linspace(0.0, 10.0, 25)
    y = 1.7 * x - 2.0 + 0.2 * np.sin(5 * x)
    xe, ye = np.full(25, 0.1), np.full(25, 0.3)
    resp = client.post(
        "/api/fitting/odr",
        json={"x": x.tolist(), "y": y.tolist(), "x_error": xe.tolist(), "y_error": ye.tolist()},
    )
    assert resp.status_code == 200
    out = resp.json()
    want = odr_fit(x, y, x_error=xe, y_error=ye)
    for key in ("slope", "intercept", "slopeErr", "interceptErr", "lambda", "rss", "rmse"):
        assert out[key] == pytest.approx(want[key], rel=1e-12)
    assert out["lambda"] == pytest.approx(9.0)
    assert out["n"] == 25


def test_odr_default_lambda_and_too_few_points() -> None:
    ok = client.post("/api/fitting/odr", json={"x": [0, 1, 2, 3], "y": [0, 1.1, 1.9, 3.2]})
    assert ok.status_code == 200 and ok.json()["lambda"] == 1.0
    bad = client.post("/api/fitting/odr", json={"x": [0, 1], "y": [0, 1]})
    assert bad.status_code == 422
