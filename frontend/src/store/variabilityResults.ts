import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { AnalysisResult } from "../lib/analysisResult";
import { variabilityAnalysisResult, variabilityRecipe, type VariabilityRecipe, type VariabilitySnapshot } from "../lib/variabilityAnalysisResult";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

export function matchesVariabilityResult(
  result: AnalysisResult,
  sourceId: string,
  sourceFingerprint: string,
  recipe: VariabilityRecipe,
): boolean {
  const saved = variabilityRecipe(result);
  return !result.stale && result.sources[0]?.datasetId === sourceId &&
    result.sourceFingerprint === sourceFingerprint && !!saved &&
    saved.responseCol === recipe.responseCol && saved.factorACol === recipe.factorACol &&
    saved.factorBCol === recipe.factorBCol;
}

export function publishVariabilityResult(
  source: Dataset,
  recipe: VariabilityRecipe,
  snapshot: VariabilitySnapshot,
): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source)) {
    state.setStatus("the variability source changed or its full worksheet is not loaded; wait for the current analysis before saving");
    return null;
  }
  const fingerprint = analysisDataFingerprint(live);
  if (state.analysisResults.some((result) => matchesVariabilityResult(result, live.id, fingerprint, recipe))) {
    state.setStatus("this variability result is already saved");
    return null;
  }
  const result = variabilityAnalysisResult(nextAnalysisResultId(), live, recipe, snapshot);
  state.recordHistory("save variability result");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result],
    status: `created ${result.name} result`,
  }));
  return result.id;
}
