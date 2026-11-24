"""Robust / quantile fits (GAP_AUDIT_9 G11): scipy and statsmodels oracles,
outlier recovery on synthetic data, fail-closed inputs, route wiring.
Tolerances were measured (see comments), not guessed."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.optimize import least_squares

from quantized.app import create_app
from quantized.calc.fit_models import evaluate
from quantized.calc.fit_quantile import quantile_fit
from quantized.calc.fit_robust import bisquare_irls, robust_curve_fit


def _line_with_outliers() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(1)
    x = np.linspace(0, 10, 60)
    y = 2.0 + 0.7 * x + 0.3 * rng.standard_normal(60)
    y[[5, 20, 41, 50]] += [8, 9, 10, 9]
    return x, y


def _decay(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


def _decay_data() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(2)
    x = np.linspace(0, 5, 50)
    y = _decay(x, np.array([3.0, 1.2, 0.5])) + 0.02 * rng.standard_normal(50)
    y[[3, 30]] += [2, -2]
    return x, y


@pytest.mark.parametrize("loss", ["soft_l1", "huber", "cauchy"])
def test_robust_loss_matches_scipy_and_recovers_truth(loss: str) -> None:
    x, y = _decay_data()
    out = robust_curve_fit(x, y, _decay, [1, 1, 0], loss=loss, f_scale=0.1)
    ref = least_squares(
        lambda p: _decay(x, p) - y, out["lsParams"], loss=loss, f_scale=0.1, x_scale="jac"
    )
    np.testing.assert_allclose(out["params"], ref.x, rtol=0, atol=1e-9)  # measured 0.0
    truth = np.array([3.0, 1.2, 0.5])
    # Plain least squares is dragged by the two outliers; the robust fit is not.
    assert np.max(np.abs(out["lsParams"] - truth)) > 0.2
    assert np.max(np.abs(out["params"] - truth)) < 0.05
    assert {3, 30} <= set(out["outliers"].tolist())


def test_linear_loss_is_plain_least_squares() -> None:
    x, y = _decay_data()
    out = robust_curve_fit(x, y, _decay, [1, 1, 0], loss="linear")
    np.testing.assert_allclose(out["params"], out["lsParams"], atol=1e-12)


def test_default_scale_is_automatic_and_reported() -> None:
    x, y = _decay_data()
    out = robust_curve_fit(x, y, _decay, [1, 1, 0], loss="huber")
    assert out["fScaleAuto"] and out["fScale"] > 0


def test_registry_model_with_bounds() -> None:
    x = np.linspace(0, 10, 40)
    y = 1.5 * x + 4.0
    y[7] += 30
    out = robust_curve_fit(
        x, y, lambda xx, p: evaluate("Linear", xx, p), [1, 0], loss="cauchy", f_scale=0.5,
        lower=[0, -np.inf], upper=[np.inf, np.inf],
    )
    np.testing.assert_allclose(out["params"], [1.5, 4.0], atol=2e-3)  # meas. 6e-4


@pytest.mark.parametrize("deg", [1, 2])
def test_bisquare_matches_statsmodels_rlm(deg: int) -> None:
    sm = pytest.importorskip("statsmodels.api")
    x, y = _line_with_outliers()
    X = np.vander(x, deg + 1, increasing=True)
    ref = sm.RLM(y, X, M=sm.robust.norms.TukeyBiweight()).fit(tol=1e-14, maxiter=2000)
    out = bisquare_irls(x, y, deg)
    # measured: params <= 1e-10, bse <= 1e-12, scale <= 1e-11
    np.testing.assert_allclose(out["coefficients"], ref.params, rtol=0, atol=1e-8)
    np.testing.assert_allclose(out["errors"], ref.bse, rtol=0, atol=1e-8)
    assert out["scale"] == pytest.approx(ref.scale, abs=1e-8)
    assert out["converged"]


def test_bisquare_recovers_line_where_ols_is_inflated() -> None:
    x, y = _line_with_outliers()
    out = bisquare_irls(x, y, 1)
    truth = np.array([2.0, 0.7])
    assert np.max(np.abs(out["coefficients"] - truth)) < 0.1
    assert np.max(np.abs(out["olsCoefficients"] - truth)) > 0.2
    assert {5, 20, 41, 50} <= set(out["outliers"].tolist())


@pytest.mark.parametrize("deg", [1, 2])
@pytest.mark.parametrize("tau", [0.1, 0.25, 0.5, 0.75, 0.9])
def test_quantile_coefficients_match_statsmodels(deg: int, tau: float) -> None:
    sm = pytest.importorskip("statsmodels.api")
    x, y = _line_with_outliers()
    X = np.vander(x, deg + 1, increasing=True)
    ref = sm.QuantReg(y, X).fit(q=tau, max_iter=5000, p_tol=1e-12)
    out = quantile_fit(x, y, tau, deg)
    np.testing.assert_allclose(out["coefficients"], ref.params, rtol=0, atol=1e-3)  # meas. 2.4e-5
    # the LP optimum can only be at least as good as the IRLS one
    e = y - X @ ref.params
    ref_loss = float(np.sum(e * (tau - (e < 0))))
    assert out["checkLoss"] <= ref_loss + 1e-9


@pytest.mark.parametrize("deg", [1, 2])
def test_quantile_median_errors_match_statsmodels(deg: int) -> None:
    sm = pytest.importorskip("statsmodels.api")
    x, y = _line_with_outliers()
    X = np.vander(x, deg + 1, increasing=True)
    ref = sm.QuantReg(y, X).fit(q=0.5, max_iter=5000, p_tol=1e-12)
    out = quantile_fit(x, y, 0.5, deg)
    np.testing.assert_allclose(out["errors"], ref.bse, rtol=1e-4)  # measured <= 1e-7 abs


def test_quantile_median_resists_outliers_and_quantiles_order() -> None:
    x, y = _line_with_outliers()
    med = quantile_fit(x, y, 0.5, 1)
    assert np.max(np.abs(med["coefficients"] - [2.0, 0.7])) < 0.15
    lo, hi = quantile_fit(x, y, 0.1, 1), quantile_fit(x, y, 0.9, 1)
    assert np.all(hi["yFit"] >= lo["yFit"] - 1e-9)


def test_fail_closed() -> None:
    x, y = _line_with_outliers()
    for tau in (0.0, 1.0, -0.2, 1.5):
        with pytest.raises(ValueError, match="tau"):
            quantile_fit(x, y, tau)
    with pytest.raises(ValueError, match="rank"):
        quantile_fit([1, 1, 1, 1], [1, 2, 3, 4], 0.5, 1)
    with pytest.raises(ValueError, match="rank"):
        bisquare_irls([1, 1, 1, 1], [1, 2, 3, 4], 1)
    with pytest.raises(ValueError, match="degree"):
        bisquare_irls(x, y, 9)
    with pytest.raises(ValueError, match="more points"):
        bisquare_irls([1, 2], [1, 2], 1)
    with pytest.raises(ValueError, match="finite"):
        bisquare_irls([1, 2, np.nan, 4], [1, 2, 3, 4], 1)
    with pytest.raises(ValueError, match="loss"):
        robust_curve_fit(x, y, _decay, [1, 1, 0], loss="bogus")
    with pytest.raises(ValueError, match="f_scale"):
        robust_curve_fit(x, y, _decay, [1, 1, 0], f_scale=-1.0)
    with pytest.raises(ValueError, match="scale is zero"):
        bisquare_irls(np.arange(10.0), 2 * np.arange(10.0) + 1, 1)


def test_routes() -> None:
    client = TestClient(create_app())
    x, y = _line_with_outliers()
    xy = {"x": x.tolist(), "y": y.tolist()}
    r = client.post("/api/fitting/robust-fit", json={**xy, "model": "Linear", "loss": "huber"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["paramNames"] and len(body["params"]) == 2 and body["lsParams"]
    assert abs(body["params"][0] - 0.7) < 0.1
    r = client.post("/api/fitting/robust-fit", json={**xy, "method": "bisquare"})
    assert r.status_code == 200 and r.json()["converged"]
    r = client.post("/api/fitting/quantile-fit", json={**xy, "tau": 0.9, "degree": 2})
    assert r.status_code == 200 and len(r.json()["coefficients"]) == 3
    tiny = {"x": [1, 2, 3], "y": [1, 2, 3]}
    assert client.post("/api/fitting/quantile-fit", json={**tiny, "tau": 1.2}).status_code == 422
    assert client.post("/api/fitting/robust-fit", json={**tiny, "model": "nope"}).status_code == 422
    bis = {**tiny, "method": "bisquare"}
    assert client.post("/api/fitting/robust-fit", json=bis).status_code == 422
