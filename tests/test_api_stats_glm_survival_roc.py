"""Integration tests for GLM/survival/ROC routes — gap #30 (TestClient).

Tests the thin routes in routes/stats_design.py for the new optional-dependency
methods. Tests both the happy path (with statsmodels/lifelines installed) and the
graceful degradation (missing extra).

Wire shape: ``predictors`` is JSON for a list of *k predictor columns*
(each a same-length array of n observations), matching
``GlmRequest``/``CoxRequest`` and the ``calc.stats_glm``/
``calc.stats_survival`` contract — never a list of n row records.
"""

from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


@pytest.mark.skipif(
    pytest.importorskip("statsmodels", minversion="0.14") is None, reason="requires statsmodels"
)
class TestGlmRoutes:
    """GLM logistic/Poisson regression routes."""

    def test_glm_logistic_route_200(self) -> None:
        """POST /api/stats/glm-logistic returns 200 with valid data.

        n=12, 2 predictor columns, non-separable (fixed-seed synthetic
        overlap — a small perfectly-separable set makes statsmodels'
        Newton-Raphson fit unstable and isn't a meaningful smoke test).
        """
        x1 = [0.13, -0.13, 0.64, 0.1, -0.54, 0.36, 1.3, 0.95, -0.7, -1.27, -0.62, 0.04]
        x2 = [-2.33, -0.22, -1.25, -0.73, -0.54, -0.32, 0.41, 1.04, -0.13, 1.37, -0.67, 0.35]
        y = [1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0]
        resp = client.post(
            "/api/stats/glm-logistic",
            json={"predictors": [x1, x2], "y": y, "alpha": 0.05},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "coeffs" in body
        assert "se" in body
        assert "zStats" in body
        assert "pValues" in body
        assert "pseudoR2" in body
        assert "AIC" in body

    def test_glm_logistic_route_422_on_invalid_y(self) -> None:
        """POST /api/stats/glm-logistic returns 422 on non-binary y."""
        resp = client.post(
            "/api/stats/glm-logistic",
            json={
                "predictors": [[1.0, 2.0, 3.0]],  # 1 predictor column, 3 rows
                "y": [0.0, 0.5, 1.0],
                "alpha": 0.05,
            },
        )
        assert resp.status_code == 422

    def test_glm_poisson_route_200(self) -> None:
        """POST /api/stats/glm-poisson returns 200 with count data.

        n=10, 2 predictor columns, real Poisson-generated counts
        (fixed-seed) — not the monotone toy set the previous version used.
        """
        x1 = [0.13, -0.13, 0.64, 0.1, -0.54, 0.36, 1.3, 0.95, -0.7, -1.27]
        x2 = [-0.62, 0.04, -2.33, -0.22, -1.25, -0.73, -0.54, -0.32, 0.41, 1.04]
        y = [0.0, 0.0, 8.0, 1.0, 2.0, 4.0, 2.0, 2.0, 1.0, 2.0]
        resp = client.post(
            "/api/stats/glm-poisson",
            json={"predictors": [x1, x2], "y": y, "alpha": 0.05},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "coeffs" in body
        assert "se" in body
        assert "deviance" in body

    def test_glm_poisson_route_422_on_non_integer(self) -> None:
        """POST /api/stats/glm-poisson returns 422 on non-integer y."""
        resp = client.post(
            "/api/stats/glm-poisson",
            json={
                "predictors": [[1.0, 2.0, 3.0]],  # 1 predictor column, 3 rows
                "y": [1.5, 2.0, 3.0],
                "alpha": 0.05,
            },
        )
        assert resp.status_code == 422


@pytest.mark.skipif(
    pytest.importorskip("lifelines", minversion="0.27") is None, reason="requires lifelines"
)
class TestSurvivalRoutes:
    """Survival analysis (KM, log-rank, Cox) routes."""

    def test_kaplan_meier_route_200(self) -> None:
        """POST /api/stats/kaplan-meier returns 200 with survival data."""
        resp = client.post(
            "/api/stats/kaplan-meier",
            json={
                "time": [1.0, 2.0, 3.0, 4.0, 5.0],
                "event": [1.0, 1.0, 0.0, 1.0, 0.0],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "times" in body
        assert "survival" in body
        assert "ciLow" in body
        assert "ciHigh" in body
        assert "medianSurvival" in body

    def test_kaplan_meier_route_422_on_negative_time(self) -> None:
        """POST /api/stats/kaplan-meier returns 422 on negative time."""
        resp = client.post(
            "/api/stats/kaplan-meier",
            json={
                "time": [1.0, -1.0, 3.0],
                "event": [1.0, 1.0, 0.0],
            },
        )
        assert resp.status_code == 422

    def test_logrank_route_200(self) -> None:
        """POST /api/stats/logrank returns 200 with two groups."""
        resp = client.post(
            "/api/stats/logrank",
            json={
                "time1": [1.0, 2.0, 3.0, 4.0],
                "event1": [1.0, 1.0, 1.0, 0.0],
                "time2": [5.0, 6.0, 7.0, 8.0],
                "event2": [1.0, 0.0, 1.0, 0.0],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "statistic" in body
        assert "pValue" in body
        assert "N1" in body
        assert "N2" in body

    def test_cox_ph_route_200(self) -> None:
        """POST /api/stats/cox-ph returns 200 with Cox model."""
        resp = client.post(
            "/api/stats/cox-ph",
            json={
                "time": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
                "event": [1.0, 1.0, 0.0, 1.0, 1.0, 0.0],
                "predictors": [[0.0, 1.0, 0.0, 1.0, 0.0, 1.0]],  # 1 predictor column, 6 rows
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "coeffs" in body
        assert "se" in body
        assert "concordanceIndex" in body
        assert "AIC" in body


class TestRocRoutes:
    """ROC curve and AUC routes (no external deps)."""

    def test_roc_curve_route_200(self) -> None:
        """POST /api/stats/roc-curve returns 200 with binary classification."""
        resp = client.post(
            "/api/stats/roc-curve",
            json={
                "y_true": [0.0, 0.0, 1.0, 1.0],
                "y_score": [0.1, 0.4, 0.6, 0.9],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "fpr" in body
        assert "tpr" in body
        assert "thresholds" in body
        assert "auc" in body

    def test_roc_curve_route_422_on_non_binary(self) -> None:
        """POST /api/stats/roc-curve returns 422 on non-binary y_true."""
        resp = client.post(
            "/api/stats/roc-curve",
            json={
                "y_true": [0.0, 0.5, 1.0],
                "y_score": [0.1, 0.5, 0.9],
            },
        )
        assert resp.status_code == 422

    def test_auc_route_200(self) -> None:
        """POST /api/stats/auc returns 200 with FPR/TPR curve."""
        resp = client.post(
            "/api/stats/auc",
            json={
                "fpr": [0.0, 0.5, 1.0],
                "tpr": [0.0, 0.7, 1.0],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "auc" in body
        assert 0.0 <= body["auc"] <= 1.0

    def test_youden_threshold_route_200(self) -> None:
        """POST /api/stats/youden-threshold returns 200 with ROC points."""
        resp = client.post(
            "/api/stats/youden-threshold",
            json={
                "fpr": [0.0, 0.3, 0.6, 1.0],
                "tpr": [0.0, 0.7, 0.9, 1.0],
                "thresholds": [1.0, 0.8, 0.5, 0.0],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "optimalThreshold" in body
        assert "youdenJ" in body
        assert "fpr" in body
        assert "tpr" in body


class TestMissingOptionalDep:
    """Test graceful degradation when optional deps are missing.

    ``sys.modules[name] = None`` simulates "package not importable" without
    actually uninstalling it — any subsequent ``import <name>`` raises
    ImportError immediately, even if submodules were already cached by an
    earlier test in this session (verified: setting only the top-level
    package to None is sufficient). ``monkeypatch`` restores the original
    entry after each test, so this can't leak into other tests. Same
    technique used in calc/stats_glm.py's own guarded-import unit test.
    """

    def test_glm_logistic_501_when_statsmodels_missing(self, monkeypatch) -> None:
        """GLM returns 501 (Not Implemented) when statsmodels missing."""
        monkeypatch.setitem(sys.modules, "statsmodels", None)
        resp = client.post(
            "/api/stats/glm-logistic",
            json={"predictors": [[1.0, 2.0, 3.0]], "y": [0.0, 1.0, 1.0], "alpha": 0.05},
        )
        assert resp.status_code == 501
        assert "quantized[stats]" in resp.json()["detail"]

    def test_survival_501_when_lifelines_missing(self, monkeypatch) -> None:
        """Survival routes return 501 when lifelines missing."""
        monkeypatch.setitem(sys.modules, "lifelines", None)
        resp = client.post(
            "/api/stats/kaplan-meier",
            json={"time": [1.0, 2.0, 3.0], "event": [1.0, 0.0, 1.0]},
        )
        assert resp.status_code == 501
        assert "quantized[stats]" in resp.json()["detail"]
