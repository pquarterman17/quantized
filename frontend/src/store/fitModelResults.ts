import { fitModelAnalysisResult, FIT_MODEL_PRODUCER, type FitModelSnapshot } from "../lib/fitModelAnalysisResult";
import type { FitModelRecipe } from "../lib/fitModelRecipe";
import { fitModelQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";

export function publishFitModelResult(source: Dataset, recipe: FitModelRecipe, snapshot: FitModelSnapshot): string | null {
  return publishSnapshotResult({
    producerId: FIT_MODEL_PRODUCER, noun: "Fit Model result", source, question: fitModelQuestion(recipe),
    changedMessage: "the Fit Model source changed or its full worksheet is not loaded; run the model again before saving",
    build: (id, live) => fitModelAnalysisResult(id, live, recipe, snapshot),
  });
}
