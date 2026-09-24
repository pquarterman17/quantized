"""POST /api/reflectivity/dream: a DREAM posterior through the job queue.

Transport, limits and refusals only; the posterior itself is owned by
test_calc_refl_dream. Mirrors test_api_fitting_bumps's job polling.
"""

from __future__ import annotations

import sys
import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.reflectivity import parratt_refl

client = TestClient(app)
_TERMINAL = ("done", "error", "cancelled")
LAYERS = [[0.0, 0.0, 0.0, 0.0], [200.0, 4e-6, 0.0, 5.0], [0.0, 2.07e-6, 0.0, 3.0]]


def _body(**over: Any) -> dict[str, Any]:
    q = np.linspace(0.01, 0.2, 200)
    r = parratt_refl(q, LAYERS)
    body: dict[str, Any] = {
        "parameters": [
            {"name": "L0.sld", "value": 0.0},
            {"name": "L1.thickness", "value": 200.0, "vary": True, "min": 150.0, "max": 250.0},
            {"name": "L1.sld", "value": 4e-6, "vary": True, "min": 3e-6, "max": 5e-6},
            {"name": "L1.roughness", "value": 5.0},
            {"name": "L2.sld", "value": 2.07e-6},
            {"name": "L2.roughness", "value": 3.0},
        ],
        "channels": [{"q": q.tolist(), "r": r.tolist(), "dr": (0.02 * r).tolist()}],
        "centre": {"L1.thickness": 200.0, "L1.sld": 4e-6},
        "samples": 300, "burn": 20, "pop": 5, "seed": 3, "band_draws": 20,
    }
    body.update(over)
    return body


def _poll_terminal(job_id: str, timeout: float = 120.0) -> list[dict[str, Any]]:
    """Every snapshot until a terminal state (CI-generous deadline)."""
    snaps: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        snaps.append(r.json())
        if snaps[-1]["status"] in _TERMINAL:
            return snaps
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def _run(**over: Any) -> dict[str, Any]:
    r = client.post("/api/reflectivity/dream", json=_body(**over))
    assert r.status_code == 200, r.text
    snaps = _poll_terminal(r.json()["job_id"])
    assert snaps[-1]["status"] == "done", snaps[-1]
    assert all(0.0 <= s["progress"] <= 1.0 for s in snaps) and snaps[-1]["progress"] == 1.0
    res = client.get(f"/api/jobs/{snaps[-1]['id']}/result")
    assert res.status_code == 200
    out: dict[str, Any] = res.json()["result"]
    return out


def test_dream_queues_a_job_and_returns_the_posterior() -> None:
    r = client.post("/api/reflectivity/dream", json=_body())
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == {"n_free": 2, "n_chains": 10, "n_generations": 50,
                            "n_evaluations": 3 + (20 + 30 + 10) * 10 + 20}
    snaps = _poll_terminal(body["job_id"])
    assert snaps[-1]["status"] == "done"
    out = client.get(f"/api/jobs/{body['job_id']}/result").json()["result"]
    names = [p["name"] for p in out["parameters"]]
    assert names == ["L1.thickness", "L1.sld"]
    lo, hi = out["parameters"][0]["interval95"]
    assert lo < 200.0 < hi  # noiseless data: the truth is the centre
    assert out["convergence"]["seed"] == 3 and out["convergence"]["n_chains"] == 10
    assert len(out["r_bands"][0]["median"]) == 200 and out["sld_bands"][0]["spin"] is None


def test_a_seed_reproduces_through_the_queue() -> None:
    assert _run()["parameters"] == _run()["parameters"]


def test_cancel_via_the_jobs_api() -> None:
    r = client.post("/api/reflectivity/dream", json=_body(samples=200_000, burn=100, pop=5))
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    assert _poll_terminal(job_id)[-1]["status"] == "cancelled"
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409


@pytest.mark.parametrize(
    ("over", "needle"),
    [
        ({"weighting": "log"}, "DREAM needs dR weighting"),
        ({"centre": {"L1.thickness": 400.0}}, "outside"),
        ({"burn": 5_000, "samples": 200_000, "pop": 20}, "model evaluations"),
        ({"samples": 10}, "greater than or equal"),
        ({"seed": -1}, "greater than or equal"),
    ],
)
def test_bad_requests_are_422_before_anything_is_queued(over: dict[str, Any], needle: str) -> None:
    before = len(client.get("/api/jobs").json()["jobs"])
    r = client.post("/api/reflectivity/dream", json=_body(**over))
    assert r.status_code == 422
    assert needle in str(r.json()["detail"])
    assert str(r.json()["detail"]).isascii()
    assert len(client.get("/api/jobs").json()["jobs"]) == before


def test_a_run_too_costly_per_evaluation_is_refused_like_a_fit() -> None:
    n = 20_000
    q = np.linspace(0.01, 0.2, n).tolist()
    chans = [{"q": q, "r": [1.0] * n, "dr": [0.1] * n, "resolution": 0.02}] * 4
    r = client.post("/api/reflectivity/dream", json=_body(channels=chans))
    assert r.status_code == 422
    assert "point-layer evaluations" in r.json()["detail"]


def test_missing_bumps_is_422_with_install_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "bumps", None)  # forces ImportError on import
    r = client.post("/api/reflectivity/dream", json=_body())
    assert r.status_code == 422
    assert "quantized[bumps]" in r.json()["detail"]
