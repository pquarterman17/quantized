"""POST /api/fitting/bootstrap/job: the bootstrap through the job queue.

Same numbers as /bootstrap (the replicate hook never changes them), a
replicate fraction, and a Cancel that stops the run and stores no result.
The cancel race is forced with a gate inside the loop (docs/testing.md).
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.routes.fitting_bootstrap as route
from quantized.app import app
from quantized.calc.fit_bootstrap import bootstrap_fit

client = TestClient(app)
_TERMINAL = ("done", "error", "cancelled")
X = list(np.linspace(0, 5, 40))
Y = [1.0 + 2.0 * v + 0.05 * float(np.sin(31.0 * v)) for v in X]
BODY: dict[str, Any] = {
    "model": "Linear", "x": X, "y": Y, "p0": [0.5, 1.0], "n_boot": 60, "seed": 2,
    "return_samples": True,
}


def _wait(job_id: str, until: Callable[[dict[str, Any]], bool]) -> dict[str, Any]:
    deadline = time.monotonic() + 60.0
    while time.monotonic() < deadline:
        snap: dict[str, Any] = client.get(f"/api/jobs/{job_id}").json()
        if until(snap):
            return snap
        time.sleep(0.02)
    raise AssertionError("timed out")


def test_job_result_is_exactly_the_synchronous_bootstrap() -> None:
    sync = client.post("/api/fitting/bootstrap", json=BODY).json()
    job_id = client.post("/api/fitting/bootstrap/job", json=BODY).json()["job_id"]
    snap = _wait(job_id, lambda s: s["status"] in _TERMINAL)
    assert snap["status"] == "done" and snap["progress"] == 1.0
    assert client.get(f"/api/jobs/{job_id}/result").json()["result"] == sync


def test_the_replicate_hook_never_changes_the_numbers_and_counts_every_replicate() -> None:
    def model(x: Any, p: Any) -> Any:
        return p[0] * x + p[1]

    seen: list[tuple[int, int]] = []
    plain = bootstrap_fit(X, Y, model, [0.5, 1.0], n_boot=40, seed=1, return_samples=True)
    hooked = bootstrap_fit(X, Y, model, [0.5, 1.0], n_boot=40, seed=1, return_samples=True,
                           on_replicate=lambda d, n: seen.append((d, n)))
    for key in plain:
        assert np.array_equal(plain[key], hooked[key]), key
    assert seen == [(i, 40) for i in range(1, 41)]


def test_progress_is_polled_then_cancel_stops_after_the_replicate_in_flight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reached, release = threading.Event(), threading.Event()
    after_release: list[int] = []

    def gated(
        *args: Any, on_replicate: Callable[[int, int], None], **kwargs: Any,
    ) -> dict[str, Any]:
        def hook(done: int, total: int) -> None:
            if done == 10:
                reached.set()
                assert release.wait(30)
            elif release.is_set():
                after_release.append(done)
            on_replicate(done, total)  # raises JobCancelled once cancelled

        return bootstrap_fit(*args, on_replicate=hook, **kwargs)

    monkeypatch.setattr(route, "bootstrap_fit", gated)
    job_id = client.post("/api/fitting/bootstrap/job", json=BODY).json()["job_id"]
    assert reached.wait(30)
    # Replicate 10's report is the one being held: 9 are reported.
    held = client.get(f"/api/jobs/{job_id}").json()
    assert held["status"] == "running"
    assert held["message"] == "replicate 9 of 60"
    assert held["progress"] == pytest.approx(9 / 60)

    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    release.set()
    snap = _wait(job_id, lambda s: s["status"] in _TERMINAL)
    assert snap["status"] == "cancelled"
    assert after_release == []  # the held report itself raised: nothing ran past it
    assert client.get(f"/api/jobs/{job_id}/result").status_code >= 400


def test_unknown_model_is_a_422_before_anything_is_queued() -> None:
    resp = client.post("/api/fitting/bootstrap/job", json={**BODY, "model": "Nope"})
    assert resp.status_code == 422


def test_a_calc_refusal_ends_the_job_as_an_error_with_the_synchronous_message() -> None:
    body = {**BODY, "n_boot": 5}
    sync = client.post("/api/fitting/bootstrap", json=body)
    assert sync.status_code == 422
    job_id = client.post("/api/fitting/bootstrap/job", json=body).json()["job_id"]
    snap = _wait(job_id, lambda s: s["status"] in _TERMINAL)
    assert snap["status"] == "error" and snap["error"] == sync.json()["detail"]
