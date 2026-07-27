// AICc model quick-scan job client (GOTO #6 + GOTO #9, P0.4 feedback/cancel
// audit tail): POST /api/fitting/scan/job queues the scan through the
// poll-model job runner and answers { job_id } at once — poll via lib/jobs
// (pollJob/cancelJob) exactly like the DREAM job in lib/fitbumps.ts. Same
// candidate math and result shape as the synchronous POST /api/fitting/scan
// (lib/api.ts's scanFitModels/ScanEntry/ScanResponse, reused here rather than
// re-declared so the two paths can never drift on shape). Kept out of
// lib/api.ts deliberately (fitbumps.ts precedent — parallel workshop work
// edits that file), but the error handling rides api.ts's shared `unwrap`
// (MAIN #8b — no drifted copy).

import { unwrap, type ScanEquationCandidate } from "./api";
import type { JobSubmitResponse } from "./jobs";

export interface ScanJobRequest {
  x: number[];
  y: number[];
  dy?: number[];
  models?: string[];
  equations?: ScanEquationCandidate[];
}

/** Queue an AICc scan; always answers { job_id } (never runs synchronously —
 *  for the direct synchronous call, use lib/api.ts's scanFitModels). */
export async function scanFitModelsJob(req: ScanJobRequest): Promise<JobSubmitResponse> {
  const res = await fetch("/api/fitting/scan/job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return unwrap<JobSubmitResponse>(res);
}
