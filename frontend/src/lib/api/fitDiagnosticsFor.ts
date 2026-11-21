// /api/fitting/diagnostics by fit result id (P4 large-payload lane,
// plans/LARGE_PAYLOAD_PLAN.md). Its own module, not a fitStats.ts export: it
// calls `fitDiagnostics` through the module boundary, so a test that mocks
// fitStats sees every request this makes. Curve Fit lazy sections only.

import { fitDiagnostics, type DiagnosticsRequest, type DiagnosticsResult } from "./fitStats";
import type { HttpError } from "./http";

/** Diagnostics for one fit (P4, plans/LARGE_PAYLOAD_PLAN.md): by the lean
 *  fit's `resultId` when it has one -- the server already holds y, the
 *  residuals and the fit's weights, so no arrays are posted -- else, and on
 *  a 409 (evicted, or a server restart since the result was saved), by the
 *  arrays `arrays()` builds from what the caller holds. `qqPoints` thins only
 *  the Q-Q display pairs; every statistic is computed on every point. */
export async function fitDiagnosticsFor(
  resultId: unknown,
  nParams: number,
  arrays: () => Omit<DiagnosticsRequest, "n_params">,
  opts: { useWeights: boolean; qqPoints: number },
  signal?: AbortSignal,
): Promise<DiagnosticsResult> {
  const common = { n_params: nParams, qq_points: opts.qqPoints };
  if (typeof resultId === "string") {
    try {
      return await fitDiagnostics({ ...common, result_id: resultId, use_weights: opts.useWeights }, signal);
    } catch (e) {
      if ((e as HttpError | null)?.status !== 409) throw e;
    }
  }
  return fitDiagnostics({ ...common, ...arrays() }, signal);
}
