"""POST /api/reflectivity/fit/job: the reflectivity fit through the job queue.

Same numbers as /fit (the optional hooks never change a fit), a polled
iteration fraction, and a Cancel that stops the solve and stores no result.
The cancel race is forced with a gate inside the solve, not repeated
(docs/testing.md).
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.routes.reflectivity as route
from quantized.app import app
from quantized.calc.refl_fit import fit_reflectivity
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
            {"name": "L1.thickness", "value": 190.0, "vary": True, "min": 150.0, "max": 250.0},
            {"name": "L1.sld", "value": 4e-6, "vary": True, "min": 3e-6, "max": 5e-6},
            {"name": "L1.roughness", "value": 5.0},
            {"name": "L2.sld", "value": 2.07e-6},
            {"name": "L2.roughness", "value": 3.0},
        ],
        "channels": [{"q": q.tolist(), "r": r.tolist(), "dr": (0.02 * r).tolist()}],
    }
    body.update(over)
    return body


def _wait(
    job_id: str, until: Callable[[dict[str, Any]], bool], timeout: float = 60.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap: dict[str, Any] = client.get(f"/api/jobs/{job_id}").json()
        if until(snap):
            return snap
        time.sleep(0.02)
    raise AssertionError("timed out")


def test_job_result_is_exactly_the_synchronous_fit() -> None:
    sync = client.post("/api/reflectivity/fit", json=_body()).json()
    job_id = client.post("/api/reflectivity/fit/job", json=_body()).json()["job_id"]
    snap = _wait(job_id, lambda s: s["status"] in _TERMINAL)
    assert snap["status"] == "done" and snap["progress"] == 1.0
    assert client.get(f"/api/jobs/{job_id}/result").json()["result"] == sync


def test_hooks_never_change_the_fit() -> None:
    params, chans = _body()["parameters"], _body()["channels"]
    seen: list[int] = []
    plain = fit_reflectivity(params, chans)
    hooked = fit_reflectivity(params, chans, on_evaluation=seen.append, abort_check=lambda: False)
    assert hooked == plain
    # the final reporting pass runs after the solve, unobserved (calc._bounded_lsq)
    assert seen == list(range(1, plain["n_evaluations"]))


def test_an_observer_that_raises_stops_the_solve() -> None:
    class Stop(Exception):
        pass

    def boom(n: int) -> None:
        if n == 3:
            raise Stop

    with pytest.raises(Stop):
        fit_reflectivity(_body()["parameters"], _body()["channels"], on_evaluation=boom)


def test_progress_is_polled_then_cancel_stops_the_solve_and_stores_no_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reached, release = threading.Event(), threading.Event()
    evaluations_after_release: list[int] = []

    def gated(*args: Any, on_evaluation: Callable[[int], None], **kwargs: Any) -> dict[str, Any]:
        def hook(n: int) -> None:
            if n == 6:
                reached.set()
                assert release.wait(30)
            if release.is_set():
                evaluations_after_release.append(n)
            on_evaluation(n)  # raises JobCancelled once cancelled

        return fit_reflectivity(*args, on_evaluation=hook, **kwargs)

    monkeypatch.setattr(route, "fit_reflectivity", gated)
    # Start far enough off that the solve needs more than six evaluations.
    job_id = client.post("/api/reflectivity/fit/job", json=_body()).json()["job_id"]
    assert reached.wait(30)
    held = client.get(f"/api/jobs/{job_id}").json()
    assert held["status"] == "running"
    # 5 evaluations were reported: 2 free parameters -> 3 per iteration -> iteration 1.
    assert held["message"] == "iteration 1 of at most 200"
    assert 0.0 < held["progress"] < 0.95

    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    release.set()
    snap = _wait(job_id, lambda s: s["status"] in _TERMINAL)
    assert snap["status"] == "cancelled"
    assert evaluations_after_release == [6]  # stopped at the very next report
    assert client.get(f"/api/jobs/{job_id}/result").status_code >= 400


def test_job_route_refuses_what_fit_refuses() -> None:
    assert client.post("/api/reflectivity/fit/job", json=_body(weighting="chi")).status_code == 422


def test_an_optimiser_refusal_ends_the_job_as_an_error_with_fits_message() -> None:
    body = _body()
    body["channels"][0]["q"] = body["channels"][0]["q"][:2]
    body["channels"][0]["r"] = body["channels"][0]["r"][:2]
    body["channels"][0]["dr"] = body["channels"][0]["dr"][:2]
    sync = client.post("/api/reflectivity/fit", json=body)
    assert sync.status_code == 422
    job_id = client.post("/api/reflectivity/fit/job", json=body).json()["job_id"]
    snap = _wait(job_id, lambda s: s["status"] in _TERMINAL)
    assert snap["status"] == "error" and snap["error"] == sync.json()["detail"]
