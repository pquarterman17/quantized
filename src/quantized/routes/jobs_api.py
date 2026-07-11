"""Poll-model background-job routes (GOTO #9): status / result / cancel / list.

Thin adapters over ``quantized.jobs``. There is deliberately NO generic
submit endpoint — jobs are submitted internally by other routes (e.g.
``POST /api/fitting/bumps`` with ``engine='dream'``), never from
client-supplied code. The SPA GET-polls ``/api/jobs/{id}`` (~1 s) only
while a job is live; no WebSocket.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from quantized.jobs import jobs
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
def list_jobs() -> dict[str, Any]:
    """Snapshots of every registered job (results omitted — poll /result)."""
    return {"jobs": jobs.list()}


@router.get("/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    """Poll one job: status / progress / message (+ error when failed)."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job id: {job_id}")
    return job.snapshot()


@router.get("/{job_id}/result")
def job_result(job_id: str) -> dict[str, Any]:
    """The completed job's result. 409 until the job reaches ``done``."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job id: {job_id}")
    snap = job.snapshot(include_result=True)
    if snap["status"] == "error":
        raise HTTPException(status_code=422, detail=f"job failed: {snap.get('error', '')}")
    if snap["status"] != "done":
        raise HTTPException(
            status_code=409, detail=f"job not finished (status: {snap['status']})"
        )
    return {"id": job_id, "status": "done", "result": to_jsonable(snap["result"])}


@router.post("/{job_id}/cancel")
def job_cancel(job_id: str) -> dict[str, Any]:
    """Request cooperative cancellation; returns the (possibly updated) snapshot."""
    job = jobs.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job id: {job_id}")
    return job.snapshot()
