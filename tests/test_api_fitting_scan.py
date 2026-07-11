"""Integration tests for POST /api/fitting/scan (GOTO #6 AICc quick-scan).

The route is a thin adapter over calc.fit_scan.scan_models: candidates rank
ascending by AICc, per-candidate failures are error ENTRIES (still 200), and
only invalid scan input is a 422. Non-finite metrics serialize as null.
"""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

SCAN = "/api/fitting/scan"


def _payload() -> dict[str, list[float]]:
    x = np.linspace(-5.0, 5.0, 81)
    y = 2.0 * np.exp(-((x - 0.5) ** 2) / (2 * 0.8**2)) + 0.01 * np.sin(7.0 * x)
    return {"x": x.tolist(), "y": y.tolist()}


def test_scan_ranks_gaussian_first_and_serializes_weights() -> None:
    resp = client.post(SCAN, json={**_payload(), "models": ["Linear", "Gaussian"]})
    assert resp.status_code == 200
    out = resp.json()
    assert out["n"] == 81
    assert out["nCandidates"] == 2
    top = out["results"][0]
    assert top["name"] == "Gaussian"
    assert top["error"] is None
    assert top["k"] == 3
    assert top["deltaAICc"] == 0.0
    assert 0.999 <= top["weight"] <= 1.0
    assert out["results"][1]["deltaAICc"] > 100


def test_scan_default_candidates_when_models_omitted() -> None:
    resp = client.post(SCAN, json=_payload())
    assert resp.status_code == 200
    out = resp.json()
    # n = 81 -> every registry model passes the nParams < n/3 cut.
    assert out["nCandidates"] >= 20
    names = [e["name"] for e in out["results"]]
    assert "Gaussian" in names and "Linear" in names


def test_scan_failing_candidate_is_error_entry_not_500() -> None:
    resp = client.post(
        SCAN,
        json={
            **_payload(),
            "models": ["Gaussian"],
            "equations": [{"name": "bad", "equation": "a*(x"}],
        },
    )
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert results[0]["name"] == "Gaussian"
    bad = results[-1]
    assert bad["name"] == "bad"
    assert bad["kind"] == "equation"
    assert "parenthes" in bad["error"].lower()
    assert bad["AICc"] is None


def test_scan_equation_candidate_with_guesses_wins() -> None:
    resp = client.post(
        SCAN,
        json={
            **_payload(),
            "models": ["Linear"],
            "equations": [
                {"name": "MyGauss", "equation": "a*exp(-(x-m)^2/(2*s^2))",
                 "guesses": [1.5, 0.0, 1.0]}
            ],
        },
    )
    assert resp.status_code == 200
    top = resp.json()["results"][0]
    assert top["name"] == "MyGauss"
    assert top["paramNames"] == ["a", "m", "s"]


def test_scan_input_validation_is_422() -> None:
    resp = client.post(SCAN, json={"x": [1, 2, 3], "y": [1, 2]})
    assert resp.status_code == 422
    resp = client.post(SCAN, json={"x": [1, 2], "y": [1, 2]})
    assert resp.status_code == 422
    payload = _payload()
    resp = client.post(SCAN, json={**payload, "dy": [0.0] * len(payload["x"])})
    assert resp.status_code == 422
