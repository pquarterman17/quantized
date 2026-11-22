import { distributionAnalysisResult, type DistributionRecipe, type DistributionSnapshot } from "../lib/distributionAnalysisResult";
import { distributionQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";

export function publishDistributionResult(source: Dataset, recipe: DistributionRecipe, snapshot: DistributionSnapshot): string | null {
  return publishSnapshotResult({
    producerId: "distribution-analysis", noun: "Distribution result", source, question: distributionQuestion(recipe),
    changedMessage: "the Distribution source changed or its full worksheet is not loaded; wait for the current analysis before saving",
    build: (id, live) => distributionAnalysisResult(id, live, recipe, snapshot),
  });
}
