"""Poll-model job runner (GOTO #9): JobStore unit tests + /api/jobs routes.

Covers the full lifecycle: submit -> progress -> done; cancel mid-run through
BOTH cooperative paths (Job.report raising JobCancelled, and the polled
abort_check flag); error capture; the pending-cancel fast path; and the thin
poll routes (404 on unknown id, 409 on a not-finished result).
"""

from __future__ import annotations

import asyncio
import threading
import time
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.jobs import (
    _PENDING_ADMISSION_BOUND,
    AbortFn,
    Job,
    JobQueueFullError,
    JobStore,
    ProgressFn,
)
from quantized.jobs import jobs as global_jobs

client = TestClient(app)

_TERMINAL = ("done", "error", "cancelled")


def _wait_terminal(store: JobStore, job_id: str, timeout: float = 30.0) -> Job:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = store.get(job_id)
        assert job is not None
        if job.status in _TERMINAL:
            return job
        time.sleep(0.01)
    job = store.get(job_id)
    assert job is not None
    raise AssertionError(f"job {job_id} did not finish (status: {job.status})")


# ── JobStore unit tests ─────────────────────────────────────────────────


def test_submit_slow_job_polls_to_done() -> None:
    store = JobStore(max_workers=1)

    def body(progress: ProgressFn, abort: AbortFn) -> int:
        for k in range(1, 4):
            time.sleep(0.01)
            progress(k / 4, f"step {k}")
        return 42

    job_id = store.submit(body)
    job = _wait_terminal(store, job_id)
    snap = job.snapshot(include_result=True)
    assert snap["status"] == "done"
    assert snap["result"] == 42
    assert snap["progress"] == 1.0  # store owns the terminal 100%
    assert snap["message"] == "step 3"


def test_progress_visible_mid_run() -> None:
    store = JobStore(max_workers=1)
    reported = threading.Event()
    release = threading.Event()

    def body(progress: ProgressFn, abort: AbortFn) -> str:
        progress(0.5, "halfway")
        reported.set()
        release.wait(timeout=10)
        return "ok"

    job_id = store.submit(body)
    assert reported.wait(timeout=10)
    job = store.get(job_id)
    assert job is not None
    snap = job.snapshot()
    assert snap["status"] == "running"
    assert snap["progress"] == 0.5
    assert snap["message"] == "halfway"
    release.set()
    assert _wait_terminal(store, job_id).status == "done"


def test_cancel_mid_run_via_report() -> None:
    """Job.report raises JobCancelled after cancel -> status 'cancelled'."""
    store = JobStore(max_workers=1)
    started = threading.Event()

    def body(progress: ProgressFn, abort: AbortFn) -> None:
        started.set()
        while True:  # report() raises JobCancelled once the flag is set
            progress(0.1, "looping")
            time.sleep(0.005)

    job_id = store.submit(body)
    assert started.wait(timeout=10)
    cancelled = store.cancel(job_id)
    assert cancelled is not None
    job = _wait_terminal(store, job_id)
    assert job.status == "cancelled"
    assert job.error == ""  # cooperative cancel is not an error


def test_cancel_mid_run_via_abort_check() -> None:
    """A body that polls abort_check() and returns is also marked cancelled."""
    store = JobStore(max_workers=1)
    started = threading.Event()

    def body(progress: ProgressFn, abort: AbortFn) -> str:
        started.set()
        while not abort():
            time.sleep(0.005)
        return "partial result"  # returned, but the run was aborted

    job_id = store.submit(body)
    assert started.wait(timeout=10)
    store.cancel(job_id)
    job = _wait_terminal(store, job_id)
    assert job.status == "cancelled"
    assert job.snapshot(include_result=True).get("result") is None


def test_cancel_pending_job() -> None:
    """Cancelling a job still queued behind another marks it immediately."""
    store = JobStore(max_workers=1)
    release = threading.Event()

    def blocker(progress: ProgressFn, abort: AbortFn) -> None:
        release.wait(timeout=10)

    def never_runs(progress: ProgressFn, abort: AbortFn) -> None:
        raise AssertionError("cancelled-while-pending job must not execute")

    store.submit(blocker)
    pending_id = store.submit(never_runs)
    cancelled = store.cancel(pending_id)
    assert cancelled is not None and cancelled.status == "cancelled"
    release.set()
    job = _wait_terminal(store, pending_id)
    assert job.status == "cancelled"  # run() double-checks the flag on start


def test_error_capture() -> None:
    store = JobStore(max_workers=1)

    def body(progress: ProgressFn, abort: AbortFn) -> None:
        raise RuntimeError("boom: synthetic failure")

    job_id = store.submit(body)
    job = _wait_terminal(store, job_id)
    snap = job.snapshot()
    assert snap["status"] == "error"
    assert "boom" in snap["error"]
    assert "result" not in job.snapshot(include_result=True)


def test_unknown_id_and_listing() -> None:
    store = JobStore(max_workers=1)
    assert store.get("nope") is None
    assert store.cancel("nope") is None

    def body(progress: ProgressFn, abort: AbortFn) -> int:
        return 1

    job_id = store.submit(body)
    _wait_terminal(store, job_id)
    listed = store.list()
    assert any(s["id"] == job_id for s in listed)
    assert all("result" not in s for s in listed)  # listing stays light


# ── /api/jobs routes ────────────────────────────────────────────────────


def _wait_api_terminal(job_id: str, timeout: float = 60.0) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        snap = r.json()
        if snap["status"] in _TERMINAL:
            return dict(snap)
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish over the API")


def test_api_unknown_job_id_404() -> None:
    assert client.get("/api/jobs/does-not-exist").status_code == 404
    assert client.get("/api/jobs/does-not-exist/result").status_code == 404
    assert client.post("/api/jobs/does-not-exist/cancel").status_code == 404


def test_api_poll_result_and_list() -> None:
    def body(progress: ProgressFn, abort: AbortFn) -> dict[str, list[float]]:
        progress(0.5, "working")
        return {"values": [1.0, 2.0]}

    job_id = global_jobs.submit(body)
    snap = _wait_api_terminal(job_id)
    assert snap["status"] == "done"
    assert snap["progress"] == 1.0

    r = client.get(f"/api/jobs/{job_id}/result")
    assert r.status_code == 200
    assert r.json()["result"] == {"values": [1.0, 2.0]}

    r = client.get("/api/jobs")
    assert any(s["id"] == job_id for s in r.json()["jobs"])


def test_api_result_before_done_is_409() -> None:
    release = threading.Event()

    def body(progress: ProgressFn, abort: AbortFn) -> str:
        release.wait(timeout=10)
        return "late"

    job_id = global_jobs.submit(body)
    try:
        r = client.get(f"/api/jobs/{job_id}/result")
        assert r.status_code == 409
    finally:
        release.set()
    _wait_api_terminal(job_id)


def test_api_error_job_result_is_422() -> None:
    def body(progress: ProgressFn, abort: AbortFn) -> None:
        raise ValueError("bad input somewhere")

    job_id = global_jobs.submit(body)
    snap = _wait_api_terminal(job_id)
    assert snap["status"] == "error"
    assert "bad input" in str(snap["error"])
    r = client.get(f"/api/jobs/{job_id}/result")
    assert r.status_code == 422
    assert "bad input" in r.json()["detail"]


# ── Item #4: Admission control ──────────────────────────────────────────────


def test_submit_rejects_when_pending_full() -> None:
    """Admission control: submit raises JobQueueFullError when pending >= bound."""
    store = JobStore(max_workers=1)
    release = threading.Event()

    def blocking_job(progress: ProgressFn, abort: AbortFn) -> None:
        """This job holds the executor busy."""
        release.wait(timeout=10)

    # Submit one blocking job to hold the executor
    store.submit(blocking_job)

    # Fill pending to the admission bound: the blocking job is running,
    # so all further submissions go to pending
    def pending_job(progress: ProgressFn, abort: AbortFn) -> None:
        pass

    # Submit jobs until we reach the bound
    for _ in range(_PENDING_ADMISSION_BOUND):
        store.submit(pending_job)

    # Next submit should be rejected
    try:
        store.submit(pending_job)
        pytest.fail("Expected JobQueueFullError")
    except JobQueueFullError as exc:
        assert str(_PENDING_ADMISSION_BOUND) in str(exc)
    finally:
        release.set()


def test_routes_import_job_queue_full_error() -> None:
    """Verify that routes import JobQueueFullError for exception handling.

    This confirms that the routes layer has access to JobQueueFullError
    to catch and translate it to 429. The actual integration test would
    require creating the full queue saturation scenario.
    """
    # Verify that fitting_bumps imports JobQueueFullError
    import quantized.routes.fitting_bumps
    assert hasattr(quantized.routes.fitting_bumps, "JobQueueFullError")

    # Verify that fitting imports JobQueueFullError
    import quantized.routes.fitting
    assert hasattr(quantized.routes.fitting, "JobQueueFullError")


# ── Item #5: Executor shutdown ──────────────────────────────────────────────


def test_app_lifespan_shuts_down_executor() -> None:
    """The app's lifespan context calls executor.shutdown on teardown."""
    from quantized.app import _app_lifespan

    # Mock the global jobs store to verify shutdown is called
    with mock.patch("quantized.app.jobs") as mock_jobs:
        async def run_test() -> None:
            async with _app_lifespan(mock.MagicMock()):
                pass  # lifespan yields on startup, continues on shutdown
            # After the context, shutdown should have been called on the pool
            mock_jobs._pool.shutdown.assert_called_once_with(wait=False, cancel_futures=True)

        asyncio.run(run_test())
