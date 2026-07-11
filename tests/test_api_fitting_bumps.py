"""POST /api/fitting/bumps (GOTO #10) + the jobs polling flow (GOTO #9).

Sync engines return the fit directly; engine='dream' returns {job_id} and the
completed job's /result payload is the same fit dict. The missing-bumps path
is unit-tested with poisoned sys.modules entries (import guard mock).
"""

from __future__ import annotations

import sys
import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

TRUE = [2.0, 0.5, 1.2]  # Gaussian A, mu, sigma
_TERMINAL = ("done", "error", "cancelled")


def _payload(**overrides: Any) -> dict[str, Any]:
    x = np.linspace(-5.0, 5.0, 201)
    y = TRUE[0] * np.exp(-((x - TRUE[1]) ** 2) / (2 * TRUE[2] ** 2))
    body: dict[str, Any] = {
        "model": "Gaussian",
        "x": x.tolist(),
        "y": y.tolist(),
        "dy": [0.02] * x.size,
        "p0": [1.0, 0.0, 1.0],
        "lower": [0.0, -5.0, 0.01],
        "upper": [10.0, 5.0, 10.0],
        "engine": "amoeba",
    }
    body.update(overrides)
    return body


def _poll_terminal(job_id: str, timeout: float = 120.0) -> list[dict[str, Any]]:
    """Poll /api/jobs/{id} to a terminal state; returns every snapshot seen.

    The deadline is CI-generous (Windows runners are ~5-6x slower)."""
    snaps: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        snaps.append(r.json())
        if snaps[-1]["status"] in _TERMINAL:
            return snaps
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} never reached a terminal state")


def test_sync_engine_200() -> None:
    r = client.post("/api/fitting/bumps", json=_payload())
    assert r.status_code == 200
    out = r.json()
    assert out["engine"] == "amoeba"
    assert out["uncertainty_kind"] == "hessian"
    np.testing.assert_allclose(out["popt"], TRUE, rtol=1e-3)
    assert len(out["yFit"]) == 201


def test_sync_engine_default_p0_via_autoguess() -> None:
    r = client.post("/api/fitting/bumps", json=_payload(p0=None))
    assert r.status_code == 200
    np.testing.assert_allclose(r.json()["popt"], TRUE, rtol=1e-2)


def test_unknown_model_and_engine_422() -> None:
    assert client.post("/api/fitting/bumps", json=_payload(model="Nope")).status_code == 422
    assert client.post("/api/fitting/bumps", json=_payload(engine="newton")).status_code == 422


def test_dream_submits_job_and_polls_to_done() -> None:
    r = client.post(
        "/api/fitting/bumps",
        json=_payload(engine="dream", samples=240, burn=10, pop=4),
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert isinstance(job_id, str) and job_id

    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "done"
    assert all(0.0 <= s["progress"] <= 1.0 for s in snaps)
    assert snaps[-1]["progress"] == 1.0

    # Transport + shape assertions only: posterior QUALITY (medians near
    # truth, intervals bracket) is owned by the seeded calc test
    # (test_calc_fit_bumps.test_dream_posterior_invariants) — an unseeded
    # small-budget run through the job queue must not flake on convergence.
    r = client.get(f"/api/jobs/{job_id}/result")
    assert r.status_code == 200
    fit = r.json()["result"]
    assert fit["engine"] == "dream"
    assert fit["uncertainty_kind"] == "posterior"
    assert len(fit["popt"]) == 3
    assert len(fit["posterior"]["medians"]) == 3
    assert len(fit["posterior"]["interval68"]) == 3
    assert fit["posterior"]["n_draws"] > 0

    # the job also shows up in the listing
    r = client.get("/api/jobs")
    assert any(s["id"] == job_id for s in r.json()["jobs"])


def test_dream_cancel_via_jobs_api() -> None:
    # A budget large enough that the cancel always lands mid-run.
    r = client.post(
        "/api/fitting/bumps",
        json=_payload(engine="dream", samples=200_000, burn=100, pop=10),
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    r = client.post(f"/api/jobs/{job_id}/cancel")
    assert r.status_code == 200

    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "cancelled"
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409


def test_missing_bumps_is_422_with_install_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    for mod in ("bumps", "bumps.curve", "bumps.fitproblem", "bumps.fitters"):
        monkeypatch.setitem(sys.modules, mod, None)  # forces ImportError on import
    r = client.post("/api/fitting/bumps", json=_payload())
    assert r.status_code == 422
    assert "quantized[bumps]" in r.json()["detail"]
