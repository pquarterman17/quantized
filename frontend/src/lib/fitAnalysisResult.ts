import type { AnalysisResult } from "./analysisResult";
import { fitAnalysisResult, fitResultId, isFitResultForDataset } from "./fitAnalysisResultLive";
import type { Dataset } from "./types";

export { fitAnalysisResult, fitResultId, isFitResultForDataset } from "./fitAnalysisResultLive";

/** Add fit catalog records to a pre-adapter workspace exactly once. Existing
 * records win so an intentional rename/note survives migration. */
export function migrateFitAnalysisResults(
  datasets: readonly Dataset[],
  existing: readonly AnalysisResult[],
  createdAt: string,
): AnalysisResult[] {
  const ids = new Set(existing.map((result) => result.id));
  const linked = new Set(datasets.flatMap((dataset) =>
    existing.some((result) => isFitResultForDataset(result, dataset.id)) ? [dataset.id] : [],
  ));
  const migrated = datasets.flatMap((dataset) => {
    if (!dataset.fitSpec || ids.has(fitResultId(dataset.id)) || linked.has(dataset.id)) return [];
    return [fitAnalysisResult(dataset, dataset.fitSpec, dataset.fitSpec.fittedAt ?? createdAt)];
  });
  return [...existing, ...migrated];
}
