// Load-side curve-fit freshness lives apart from the eager save-side stamper.
// Workspace parsing is lazy/worker-backed; keeping this scan there prevents a
// load-only catalog adapter from spending startup bytes.

import type { AnalysisResult } from "./analysisResult";
import { dataFingerprint } from "./analysisResultFreshness";
import type { Dataset } from "./types";

export function staleAnalysisFits(results: readonly AnalysisResult[], datasets: readonly Dataset[]): string[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const stale = new Set<string>();
  for (const result of results) {
    if (result.settingsRef?.field !== "fitSpec") continue;
    const source = byId.get(result.settingsRef.datasetId);
    if (!source?.fitSpec || source.pending) continue;
    if (result.stale === true ||
        (result.sourceFingerprint !== undefined && result.sourceFingerprint !== dataFingerprint(source.data))) {
      stale.add(source.id);
    }
  }
  return [...stale];
}
