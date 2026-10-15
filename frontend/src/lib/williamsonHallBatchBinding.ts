import type { AnalysisResult, AnalysisResultValue } from "./analysisResult";
import type { Dataset } from "./types";
import { williamsonHallPeakTableFingerprint } from "./williamsonHallRecipe";

/** Verify the fitted-peak revisions used by a saved comparison without
 * importing the lazy batch runner into the eager freshness path. */
export function williamsonHallBatchPeakBindingsMatch(result: AnalysisResult, sources: readonly Dataset[]): boolean {
  if (result.producer.id !== "williamson-hall-batch") return true;
  const recipe = result.parameters?.recipe;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return false;
  const items = (recipe as Record<string, AnalysisResultValue>).items;
  if (!Array.isArray(items) || items.length !== sources.length) return false;
  const byId = new Map(sources.map((source) => [source.id, source]));
  return items.every((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as Record<string, AnalysisResultValue>;
    const source = typeof item.datasetId === "string" ? byId.get(item.datasetId) : undefined;
    return !!source?.peakTable && typeof item.peakTableFingerprint === "string" &&
      item.peakTableFingerprint === williamsonHallPeakTableFingerprint(source.peakTable);
  });
}
