"""Integration tests for POST /api/fitting/scan (GOTO #6 AICc quick-scan) and
its job-queued sibling POST /api/fitting/scan/job (P0.4 feedback/cancel tail).

The sync route is a thin adapter over calc.fit_scan.scan_models: candidates
rank ascending by AICc, per-candidate failures are error ENTRIES (still 200),
and only invalid scan input is a 422. Non-finite metrics serialize as null.
The job route queues the identical scan through quantized.jobs (GOTO #9):
same result shape on completion, progress messages name the candidate in
flight, and a cancel ends the job "cancelled" with no partial result — the
same contract as the DREAM job in test_api_fitting_bumps.py.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc import fit_scan

client = TestClient(app)

SCAN = "/api/fitting/scan"
SCAN_JOB = "/api/fitting/scan/job"
_TERMINAL = ("done", "error", "cancelled")


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
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached a terminal state")


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


# ── POST /api/fitting/scan/job (job-queued, P0.4 feedback/cancel tail) ──────


def test_scan_job_submits_and_matches_the_sync_result() -> None:
    payload = {**_payload(), "models": ["Linear", "Gaussian"]}
    r = client.post(SCAN_JOB, json=payload)
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert isinstance(job_id, str) and job_id

    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "done"
    assert snaps[-1]["progress"] == 1.0
    # at least one snapshot named a candidate in flight
    assert any("Scanning" in s.get("message", "") for s in snaps)

    r = client.get(f"/api/jobs/{job_id}/result")
    assert r.status_code == 200
    queued = r.json()["result"]
    synced = client.post(SCAN, json=payload).json()
    assert queued == synced  # identical shape/values, sync vs queued

    # the job also shows up in the listing
    r = client.get("/api/jobs")
    assert any(s["id"] == job_id for s in r.json()["jobs"])


def test_scan_job_invalid_input_becomes_a_job_error_not_a_422() -> None:
    # the job route has no synchronous response to attach a 422 to — invalid
    # scan input (too few points) surfaces on poll instead.
    r = client.post(SCAN_JOB, json={"x": [1, 2], "y": [1, 2]})
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "error"
    assert "at least 3" in snaps[-1]["error"]
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 422


def test_scan_job_cancel_via_jobs_api_ends_cancelled_with_no_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # scan_models has no artificial slowdown knob (unlike DREAM's `samples`);
    # slow each candidate down deterministically so the cancel reliably lands
    # mid-scan instead of racing a sub-millisecond default-candidate-set run.
    real_run_candidate = fit_scan._run_candidate

    def slow_run_candidate(*args: Any, **kwargs: Any) -> dict[str, Any]:
        time.sleep(0.05)
        return real_run_candidate(*args, **kwargs)

    monkeypatch.setattr(fit_scan, "_run_candidate", slow_run_candidate)

    payload = {**_payload(), "models": ["Linear", "Gaussian", "Lorentzian", "Quadratic"]}
    r = client.post(SCAN_JOB, json=payload)
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    time.sleep(0.05)  # let the first candidate or two start
    r = client.post(f"/api/jobs/{job_id}/cancel")
    assert r.status_code == 200

    snaps = _poll_terminal(job_id)
    assert snaps[-1]["status"] == "cancelled"
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409

    # the queue recovers cleanly: a fresh scan still works.
    r = client.post(SCAN_JOB, json={**_payload(), "models": ["Linear"]})
    assert r.status_code == 200
    snaps = _poll_terminal(r.json()["job_id"])
    assert snaps[-1]["status"] == "done"
