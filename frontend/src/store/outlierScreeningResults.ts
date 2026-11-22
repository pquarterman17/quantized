import {
  outlierScreeningAnalysisResult, type OutlierScreeningRecipe, type OutlierScreeningSnapshot,
} from "../lib/outlierScreeningAnalysisResult";
import { outlierQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";

export function publishOutlierScreeningResult(
  source: Dataset, recipe: OutlierScreeningRecipe, snapshot: OutlierScreeningSnapshot,
): string | null {
  return publishSnapshotResult({
    producerId: "outlier-screening", noun: "outlier-screening result", source, question: outlierQuestion(recipe),
    changedMessage: "the outlier-screening source changed or its full worksheet is not loaded; run the current screen before saving",
    build: (id, live) => outlierScreeningAnalysisResult(id, live, recipe, snapshot),
  });
}
