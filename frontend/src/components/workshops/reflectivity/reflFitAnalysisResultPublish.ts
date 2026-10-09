import type { AnalysisResult } from "../../../lib/analysisResult";
import {
  reflectivityFitAnalysisResult,
  reflectivityFitResultId,
} from "../../../lib/reflFitAnalysisResult";
import type { Dataset } from "../../../lib/types";

/** Register exactly the newly published fit without resurrecting result
 * records the user deliberately deleted. Also retire catalog entries whose
 * scientific record just fell out of the bounded fit history. This stays in
 * the lazy reflectivity chunk; project migration needs only the small reader. */
export function publishReflectivityFitAnalysisResult(
  datasets: readonly Dataset[],
  existing: readonly AnalysisResult[],
  recordValue: unknown,
): AnalysisResult[] {
  const created = reflectivityFitAnalysisResult(recordValue, datasets);
  if (!created || created.settingsRef?.field !== "reflFits") return [...existing];
  const createdRecordId = created.settingsRef.recordId;
  const createdDatasetId = created.settingsRef.datasetId;
  const presentDatasetIds = new Set(datasets.map((dataset) => dataset.id));
  const liveRecordKeys = new Set<string>();
  for (const dataset of datasets) {
    if (!Array.isArray(dataset.reflFits)) continue;
    for (const stored of dataset.reflFits) {
      const live = reflectivityFitAnalysisResult(stored, datasets);
      if (live) liveRecordKeys.add(live.id);
    }
  }
  const kept = existing.filter((result) => {
    const ref = result.settingsRef;
    if (ref?.field !== "reflFits" || liveRecordKeys.has(reflectivityFitResultId(ref.datasetId, ref.recordId))) return true;
    // All sources absent means "temporarily missing", not trimmed history.
    return !result.sources.some((source) => presentDatasetIds.has(source.datasetId));
  });
  return kept.some((result) => result.settingsRef?.field === "reflFits" &&
      result.settingsRef.datasetId === createdDatasetId && result.settingsRef.recordId === createdRecordId)
    ? kept
    : [...kept, created];
}
