"""Background job registry — poll-model long-op progress (GOTO #9).

Thread-pool execution with polled status, mirroring fermiviewer's ``jobs.py``:
routes submit a callable (usually a closure over a pure calc function) and
return a job id; the frontend GET-polls ``/api/jobs/{id}`` while the job is
live. No WebSocket — polling is the transport.

Lives at the package root: ``calc``/``io`` are pure libraries (no threading,
no long-op state), and ``routes`` are thin adapters (``routes/jobs_api.py``
adapts this store). Cancellation is cooperative: ``JobStore.cancel`` sets an
abort flag; the job body observes it through its ``abort_check`` callable, and
``Job.report`` (the progress callback) raises :class:`JobCancelled` so any
job that reports progress cancels promptly without extra plumbing.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

__all__ = ["AbortFn", "Job", "JobCancelled", "JobStore", "ProgressFn", "jobs"]

ProgressFn = Callable[[float, str], None]
AbortFn = Callable[[], bool]

_TERMINAL = ("done", "error", "cancelled")


class JobCancelled(Exception):
    """Raised inside a job body when cancellation was requested."""


@dataclass
class Job:
    id: str
    status: str = "pending"  # pending | running | done | error | cancelled
    progress: float = 0.0
    message: str = ""
    result: Any = None
    error: str = ""
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _abort: threading.Event = field(default_factory=threading.Event, repr=False)

    def report(self, fraction: float, message: str = "") -> None:
        """Progress callback handed to the job body.

        Raises :class:`JobCancelled` when a cancel has been requested, so a
        job that reports progress honours cancellation with no extra checks.
        """
        if self._abort.is_set():
            raise JobCancelled(f"job {self.id} cancelled")
        with self._lock:
            self.progress = max(0.0, min(1.0, fraction))
            if message:
                self.message = message

    def aborted(self) -> bool:
        """Abort flag for job bodies that poll instead of report."""
        return self._abort.is_set()

    def snapshot(self, include_result: bool = False) -> dict[str, Any]:
        with self._lock:
            out: dict[str, Any] = {
                "id": self.id,
                "status": self.status,
                "progress": self.progress,
                "message": self.message,
            }
            if self.status == "error":
                out["error"] = self.error
            if include_result and self.status == "done":
                out["result"] = self.result
            return out


class JobStore:
    """ThreadPoolExecutor-backed registry of polled background jobs."""

    def __init__(self, max_workers: int = 2) -> None:
        self._jobs: dict[str, Job] = {}
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="qz-job")
        self._lock = threading.Lock()

    def submit(self, fn: Callable[[ProgressFn, AbortFn], Any]) -> str:
        """Run ``fn(progress, abort_check)`` in the pool; returns the id at once.

        ``progress(fraction, message)`` updates the polled snapshot (and raises
        :class:`JobCancelled` after a cancel request); ``abort_check()`` returns
        True once cancellation was requested, for bodies that poll the flag
        between iterations instead.
        """
        job = Job(id=uuid.uuid4().hex[:12])
        with self._lock:
            # Bound the registry: drop the oldest finished jobs past 100.
            if len(self._jobs) > 100:
                finished = [k for k, j in self._jobs.items() if j.status in _TERMINAL]
                for k in finished[:50]:
                    del self._jobs[k]
            self._jobs[job.id] = job

        def run() -> None:
            with job._lock:
                if job._abort.is_set():
                    job.status = "cancelled"
                    return
                job.status = "running"
            try:
                result = fn(job.report, job.aborted)
                with job._lock:
                    if job._abort.is_set():
                        job.status = "cancelled"
                    else:
                        job.result = result
                        job.progress = 1.0
                        job.status = "done"
            except JobCancelled:
                with job._lock:
                    job.status = "cancelled"
            except Exception as e:  # noqa: BLE001 — surfaced to the polling client
                with job._lock:
                    job.error = str(e)
                    job.status = "error"

        self._pool.submit(run)
        return job.id

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        """Request cancellation; returns the job (or None if unknown).

        Sets the abort flag checked by the job's callbacks. A still-pending
        job is marked cancelled immediately; a finished job is left as-is.
        """
        job = self._jobs.get(job_id)
        if job is None:
            return None
        with job._lock:
            if job.status in ("pending", "running"):
                job._abort.set()
                if job.status == "pending":
                    job.status = "cancelled"
        return job

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._jobs.values())
        return [j.snapshot() for j in items]


jobs = JobStore()
"""Process-wide default job store."""
