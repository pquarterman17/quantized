// /api/peaks/model-fit-batch + its job (audit P2.4 slice 4). The route queues
// `calc.peak_model_batch.fit_peak_model_batch` on the poll-based job queue
// (src/quantized/routes/peaks_batch.py): submit returns a job id at once; the
// batch hook GET-polls /api/jobs/{id}, cancels through /api/jobs/{id}/cancel
// and reads the rows from /api/jobs/{id}/result.
//
// The job transport is restated here (three one-line calls), not imported
// from lib/jobs.ts, for the reason lib/api/reflectivity.ts gives: lib/jobs
// lives in the lazy Curve Fit chunk, and a second lazy importer splits it
// into a shared chunk the EAGER entry then lists in its preload maps. The
// poll LOOP lives in usePeakBatch.ts, which owns its cancellation.

import { getJSON, postJSON } from "./http";
import type { components } from "./schema";

export type PeakBatchRequest = components["schemas"]["PeakModelBatchRequest"];
/** One item: a `/model-fit` problem (the backend's shared `PeakModelProblem`
 *  — the fit request minus its range / budget fields) plus its `id`. The
 *  route types only the envelope and validates each item inside the job, so
 *  the item type is derived from the single-fit request here. */
export type PeakBatchItem = Omit<
  components["schemas"]["PeakModelFitRequest"],
  "x_min" | "x_max" | "max_nfev" | "deadline_s"
> & { id: string };
type Submitted = components["schemas"]["PeakModelBatchSubmitted"];
type FitResponse = components["schemas"]["PeakModelFitResponse"];

/** One item's fit as the job returns it: the `/model-fit` response without
 *  the curves and correlation (calc/peak_model_batch.py drops both). */
export type PeakBatchFit = Omit<FitResponse, "curves" | "correlation">;

export interface PeakBatchRow {
  id: string;
  status: "ok" | "error" | "not_run";
  error: string | null;
  fit: PeakBatchFit | null;
}

export interface PeakBatchResult {
  rows: PeakBatchRow[];
  n_items: number;
  n_ok: number;
  n_failed: number;
  n_not_run: number;
  stopped: "deadline" | null;
}

export interface BatchJobSnapshot {
  status: "pending" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  error?: string;
}

export function submitPeakBatch(body: PeakBatchRequest, signal?: AbortSignal): Promise<Submitted> {
  return postJSON("/api/peaks/model-fit-batch", body, signal);
}

export function batchJobStatus(id: string): Promise<BatchJobSnapshot> {
  return getJSON(`/api/jobs/${id}`);
}

export async function batchJobResult(id: string): Promise<PeakBatchResult> {
  return (await getJSON<{ result: PeakBatchResult }>(`/api/jobs/${id}/result`)).result;
}

export function cancelBatchJob(id: string): Promise<unknown> {
  return postJSON(`/api/jobs/${id}/cancel`, {});
}
