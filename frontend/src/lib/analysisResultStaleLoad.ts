// Load-only analysis-result freshness scan. Workspace parsing is lazy and
// worker-backed, so keeping this out of the save-side stamper avoids charging
// the startup bundle for code that only runs while opening a workspace.

import type { AnalysisResult } from "./analysisResult";
import { dataFingerprint } from "./analysisResultFreshness";
import type { Dataset } from "./types";

function sourcesFingerprint(result: AnalysisResult, byId: ReadonlyMap<string, Dataset>): string | null {
  const refs = [...result.sources, ...result.outputs].map((ref) => byId.get(ref.datasetId));
  if (result.sources.length === 0 || refs.some((dataset) => !dataset || dataset.pending)) return null;
  return result.sources.map((ref) => dataFingerprint(byId.get(ref.datasetId)!.data)).join(":");
}

/** The output ids that are out of date in the file just parsed. */
export function staleAnalysisOutputs(results: readonly AnalysisResult[], datasets: readonly Dataset[]): string[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const stale = new Set<string>();
  for (const result of results) {
    const now = result.stale === true || result.sourceFingerprint === undefined ? null : sourcesFingerprint(result, byId);
    if (result.stale !== true && (now === null || now === result.sourceFingerprint)) continue;
    for (const ref of result.outputs) if (byId.has(ref.datasetId)) stale.add(ref.datasetId);
  }
  return [...stale];
}
