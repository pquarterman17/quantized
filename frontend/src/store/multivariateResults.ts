import type { AnalysisResult } from "../lib/analysisResult";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import {
  multivariateAnalysisResult, multivariateRecipe, multivariateSnapshotMatchesRecipe, sameMultivariateQuestion,
  type MultivariateRecipe, type MultivariateSnapshot,
} from "../lib/multivariateAnalysisResult";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

export function matchesMultivariateResult(
  result: AnalysisResult, sourceId: string, sourceFingerprint: string, recipe: MultivariateRecipe,
): boolean {
  const saved = multivariateRecipe(result);
  return !result.stale && result.sources[0]?.datasetId === sourceId &&
    result.sourceFingerprint === sourceFingerprint && !!saved && sameMultivariateQuestion(saved, recipe);
}

export function publishMultivariateResult(
  source: Dataset, recipe: MultivariateRecipe, snapshot: MultivariateSnapshot,
): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source)) {
    state.setStatus("the multivariate source changed or its full worksheet is not loaded; wait for the current analysis before saving");
    return null;
  }
  const expectedLabels = recipe.columns.map((index) => index < 0
    ? String(live.data.metadata?.["x_column_name"] ?? "x")
    : live.data.labels[index]);
  if (!multivariateSnapshotMatchesRecipe(recipe, snapshot) ||
      snapshot.labels.some((label, index) => label !== expectedLabels[index])) {
    state.setStatus("the multivariate outputs do not match the current columns and settings; wait for the current analysis before saving");
    return null;
  }
  const fingerprint = analysisDataFingerprint(live);
  if (state.analysisResults.some((result) => matchesMultivariateResult(result, live.id, fingerprint, recipe))) {
    state.setStatus("this multivariate result is already saved");
    return null;
  }
  const result = multivariateAnalysisResult(nextAnalysisResultId(), live, recipe, snapshot);
  state.recordHistory("save multivariate result");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result], status: `created ${result.name} result`,
  }));
  return result.id;
}
