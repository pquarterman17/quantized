"""The interactive lane: a short job never queues behind long ones.

The main pool is saturated with gated jobs (forced, not timed), then an
interactive job must still start and finish.
"""

from __future__ import annotations

import threading
import time

from quantized.jobs import JobStore


def _wait(store: JobStore, job_id: str, status: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        job = store.get(job_id)
        assert job is not None
        if job.status == status:
            return
        time.sleep(0.01)
    raise AssertionError(f"{job_id} never reached {status}")


def test_interactive_job_runs_while_the_main_pool_is_saturated() -> None:
    store = JobStore(max_workers=2)
    release = threading.Event()
    long_ids = [store.submit(lambda p, a: release.wait(30)) for _ in range(2)]
    for jid in long_ids:
        _wait(store, jid, "running")
    queued = store.submit(lambda p, a: "queued-behind")  # third long job: stuck pending
    quick = store.submit(lambda p, a: "fast", interactive=True)
    _wait(store, quick, "done")
    assert store.get(quick) is not None and store.get(quick).result == "fast"  # type: ignore[union-attr]
    assert store.get(queued).status == "pending"  # type: ignore[union-attr]
    release.set()
    _wait(store, queued, "done")
    store.shutdown()


def test_a_shut_down_interactive_pool_is_replaced() -> None:
    store = JobStore()
    store.shutdown()
    jid = store.submit(lambda p, a: 1, interactive=True)
    _wait(store, jid, "done")
    store.shutdown()
