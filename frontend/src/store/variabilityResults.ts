import { variabilityQuestion } from "../lib/snapshotResultKey";
import { variabilityAnalysisResult, type VariabilityRecipe, type VariabilitySnapshot } from "../lib/variabilityAnalysisResult";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";

export function publishVariabilityResult(
  source: Dataset,
  recipe: VariabilityRecipe,
  snapshot: VariabilitySnapshot,
): string | null {
  return publishSnapshotResult({
    producerId: "variability-analysis", noun: "variability result", source, question: variabilityQuestion(recipe),
    changedMessage: "the variability source changed or its full worksheet is not loaded; wait for the current analysis before saving",
    build: (id, live) => variabilityAnalysisResult(id, live, recipe, snapshot),
  });
}
