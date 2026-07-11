// bumps optional fit engine client (GOTO #10). POST /api/fitting/bumps —
// the fast engines (amoeba / lm / de) answer synchronously with the fit;
// engine "dream" answers { job_id } to be polled via lib/jobs. Kept out of
// lib/api.ts deliberately (parallel workshop work edits that file), but the
// error handling rides api.ts's shared `unwrap` (MAIN #8b — no drifted copy).

import { unwrap } from "./api";

export type BumpsEngine = "amoeba" | "lm" | "de" | "dream";

export const BUMPS_ENGINES: readonly BumpsEngine[] = ["amoeba", "lm", "de", "dream"];

export interface BumpsFitRequest {
  model: string;
  x: number[];
  y: number[];
  dy?: number[];
  p0?: number[];
  lower?: number[];
  upper?: number[];
  engine: BumpsEngine;
  /** DREAM-only tuning (ignored by the synchronous engines). */
  samples?: number;
  burn?: number;
  pop?: number;
  return_samples?: boolean;
}

export interface BumpsPosterior {
  medians: number[];
  /** Central 68% credible interval [lo, hi] per parameter. */
  interval68: number[][];
  n_draws: number;
}

export interface BumpsFitResult {
  engine: BumpsEngine;
  popt: number[];
  uncertainties: (number | null)[];
  chisq: number | null;
  /** How the uncertainties were derived — label them by kind in the UI. */
  uncertainty_kind: "hessian" | "posterior";
  paramNames: string[];
  yFit: (number | null)[];
  posterior?: BumpsPosterior;
  samples?: number[][];
}

export type BumpsFitResponse = BumpsFitResult | { job_id: string };

export async function fitBumps(req: BumpsFitRequest): Promise<BumpsFitResponse> {
  const res = await fetch("/api/fitting/bumps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return unwrap<BumpsFitResponse>(res);
}
