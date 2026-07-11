// Poll client for the backend job runner (GOTO #9). No WebSocket — the SPA
// GET-polls /api/jobs/{id} (~1 s) ONLY while a job is live and stops on the
// first terminal state (done | error | cancelled). Mirrors the backend
// contract in src/quantized/routes/jobs_api.py. Error handling rides
// api.ts's shared `unwrap` (MAIN #8b — no drifted copy).

import { unwrap } from "./api";

export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  progress: number; // 0..1
  message: string;
  error?: string;
}

/** Shape returned by endpoints that queue long work instead of answering. */
export interface JobSubmitResponse {
  job_id: string;
}

/** Narrow a mixed sync-or-job response to the queued-job case. */
export function isJobSubmit(r: unknown): r is JobSubmitResponse {
  return (
    typeof r === "object" &&
    r !== null &&
    typeof (r as { job_id?: unknown }).job_id === "string"
  );
}

/** Thrown by pollJob when the job ends as cancelled — deliberate, not an error. */
export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`job ${jobId} cancelled`);
    this.name = "JobCancelledError";
  }
}

export async function jobStatus(id: string): Promise<JobSnapshot> {
  return unwrap<JobSnapshot>(await fetch(`/api/jobs/${id}`));
}

export async function jobResult<T>(id: string): Promise<T> {
  const out = await unwrap<{ result: T }>(await fetch(`/api/jobs/${id}/result`));
  return out.result;
}

export async function cancelJob(id: string): Promise<JobSnapshot> {
  return unwrap<JobSnapshot>(await fetch(`/api/jobs/${id}/cancel`, { method: "POST" }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a job to its terminal state.
 *
 * Resolves with the job's result on `done`; throws Error(job error) on
 * `error`; throws JobCancelledError on `cancelled`. `onProgress` fires on
 * every poll with the current fraction + message.
 */
export async function pollJob<T>(
  id: string,
  onProgress?: (fraction: number, message: string) => void,
  intervalMs = 1000,
): Promise<T> {
  for (;;) {
    const snap = await jobStatus(id);
    onProgress?.(snap.progress, snap.message);
    if (snap.status === "done") return jobResult<T>(id);
    if (snap.status === "error") throw new Error(snap.error || "job failed");
    if (snap.status === "cancelled") throw new JobCancelledError(id);
    await sleep(intervalMs);
  }
}
