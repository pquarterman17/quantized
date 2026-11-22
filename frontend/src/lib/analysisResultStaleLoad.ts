// Load-only analysis-result freshness scan. Workspace parsing is lazy and
// worker-backed, so keeping this out of the save-side stamper avoids charging
// the startup bundle for code that only runs while opening a workspace.

import type { AnalysisResult } from "./analysisResult";
import { sourcesFingerprint, VIEW_FINGERPRINT_PREFIX } from "./analysisResultFreshness";
import type { Dataset } from "./types";

/** The output ids that are out of date in the file just parsed. */
export function staleAnalysisOutputs(results: readonly AnalysisResult[], datasets: readonly Dataset[]): string[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const stale = new Set<string>();
  for (const result of results) {
    // Judge by the kind the stored value was taken with (see VIEW_FINGERPRINT_PREFIX).
    const kind = result.sourceFingerprint?.startsWith(VIEW_FINGERPRINT_PREFIX) ? "view" : "raw";
    const now = result.stale === true || result.sourceFingerprint === undefined ? null : sourcesFingerprint(result, byId, kind);
    if (result.stale !== true && (now === null || now === result.sourceFingerprint)) continue;
    for (const ref of result.outputs) if (byId.has(ref.datasetId)) stale.add(ref.datasetId);
  }
  return [...stale];
}
