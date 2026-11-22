import {
  multivariateAnalysisResult, multivariateSnapshotMatchesRecipe, type MultivariateRecipe, type MultivariateSnapshot,
} from "../lib/multivariateAnalysisResult";
import { multivariateQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";

export function publishMultivariateResult(
  source: Dataset, recipe: MultivariateRecipe, snapshot: MultivariateSnapshot,
): string | null {
  return publishSnapshotResult({
    producerId: "multivariate-analysis", noun: "multivariate result", source, question: multivariateQuestion(recipe),
    changedMessage: "the multivariate source changed or its full worksheet is not loaded; wait for the current analysis before saving",
    precheck: (live) => {
      const expectedLabels = recipe.columns.map((index) => index < 0
        ? String(live.data.metadata?.["x_column_name"] ?? "x")
        : live.data.labels[index]);
      return !multivariateSnapshotMatchesRecipe(recipe, snapshot) ||
        snapshot.labels.some((label, index) => label !== expectedLabels[index])
        ? "the multivariate outputs do not match the current columns and settings; wait for the current analysis before saving"
        : null;
    },
    build: (id, live) => multivariateAnalysisResult(id, live, recipe, snapshot),
  });
}
