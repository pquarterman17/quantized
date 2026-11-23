import type { AnalysisResult } from "../../../lib/analysisResult";
import {
  isReflFitCatalogEntry,
  reflectivityFitAnalysisResult,
  reflectivityFitResultId,
} from "../../../lib/reflFitAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { fitInputsRecord } from "./reflFitInputs";
import { decodeRecord } from "./reflFitRecord";

/** Register exactly the newly published fit without resurrecting result
 * records the user deliberately deleted. Also retire catalog entries whose
 * scientific record just fell out of the bounded fit history. This stays in
 * the lazy reflectivity chunk; project migration needs only the small reader. */
export function publishReflectivityFitAnalysisResult(
  datasets: readonly Dataset[],
  existing: readonly AnalysisResult[],
  recordValue: unknown,
): AnalysisResult[] {
  // The record AS STORED (encoded), the form a reader fingerprints (lib/resultInputsRecord.ts).
  const id = recordValue && typeof recordValue === "object" ? (recordValue as { id?: unknown }).id : undefined;
  const stored = datasets.flatMap((dataset) => (Array.isArray(dataset.reflFits) ? dataset.reflFits : []))
    .find((item) => !!item && typeof item === "object" && (item as { id?: unknown }).id === id) ?? recordValue;
  // C9: the fit was just computed, so its inputs can be restated (reflFitInputs.ts).
  const decoded = decodeRecord(stored);
  const created = reflectivityFitAnalysisResult(stored, datasets, decoded ? fitInputsRecord(decoded, datasets) : undefined);
  if (!created || created.settingsRef?.field !== "reflFits") return [...existing];
  const createdRecordId = created.settingsRef.recordId;
  const createdDatasetId = created.settingsRef.datasetId;
  const presentDatasetIds = new Set(datasets.map((dataset) => dataset.id));
  const liveRecordKeys = new Set<string>();
  const storedRecordKeys = new Set<string>();
  for (const dataset of datasets) {
    if (!Array.isArray(dataset.reflFits)) continue;
    for (const stored of dataset.reflFits) {
      // Preserve a catalog entry when its backing record is present but this
      // version cannot decode it (for example, a project written by a newer
      // Quantized). Cleanup may retire only records known to be absent.
      if (stored && typeof stored === "object" && typeof (stored as { id?: unknown }).id === "string") {
        storedRecordKeys.add(reflectivityFitResultId(dataset.id, (stored as { id: string }).id));
      }
      const live = reflectivityFitAnalysisResult(stored, datasets);
      if (live) liveRecordKeys.add(live.id);
    }
  }
  const kept = existing.filter((result) => {
    const ref = result.settingsRef;
    // Only catalog entries retire with their record; a curves or bands result keeps its worksheets listed.
    if (ref?.field !== "reflFits" || !isReflFitCatalogEntry(result)) return true;
    const key = reflectivityFitResultId(ref.datasetId, ref.recordId);
    if (liveRecordKeys.has(key) || storedRecordKeys.has(key)) return true;
    // A shared record can survive only on a secondary source after partial
    // restoration; its envelope still points at the original host.
    if (result.sources.some((source) =>
      storedRecordKeys.has(reflectivityFitResultId(source.datasetId, ref.recordId)))) return true;
    // All sources absent means "temporarily missing", not trimmed history.
    return !result.sources.some((source) => presentDatasetIds.has(source.datasetId));
  });
  return kept.some((result) => isReflFitCatalogEntry(result) && result.settingsRef?.field === "reflFits" &&
      result.settingsRef.datasetId === createdDatasetId && result.settingsRef.recordId === createdRecordId)
    ? kept
    : [...kept, created];
}
