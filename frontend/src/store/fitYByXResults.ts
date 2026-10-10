import { fitYByXAnalysisResult, fitYByXRecipe, type FitYByXMode, type FitYByXRecipe, type FitYByXSnapshot } from "../lib/fitYByXAnalysisResult";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { AnalysisResult } from "../lib/analysisResult";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

export function matchesFitYByXResult(
  result: AnalysisResult,
  sourceId: string,
  sourceFingerprint: string,
  recipe: FitYByXRecipe,
  mode: FitYByXMode,
): boolean {
  const saved = fitYByXRecipe(result);
  return !result.stale && result.producer.id === "fit-y-by-x" && result.sources[0]?.datasetId === sourceId &&
    result.sourceFingerprint === sourceFingerprint && result.parameters?.mode === mode && !!saved &&
    saved.xCol === recipe.xCol && saved.yCol === recipe.yCol && saved.byCol === recipe.byCol &&
    saved.order === recipe.order && saved.bandInterval === recipe.bandInterval;
}

export function publishFitYByXResult(source: Dataset, recipe: FitYByXRecipe, snapshot: FitYByXSnapshot): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source)) {
    state.setStatus("the Fit Y by X source changed or its full worksheet is not loaded; wait for the current analysis before saving");
    return null;
  }
  const fingerprint = analysisDataFingerprint(live);
  if (state.analysisResults.some((result) => matchesFitYByXResult(result, live.id, fingerprint, recipe, snapshot.mode))) {
    state.setStatus("this Fit Y by X result is already saved");
    return null;
  }
  const result = fitYByXAnalysisResult(nextAnalysisResultId(), live, recipe, snapshot);
  state.recordHistory("save Fit Y by X result");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result],
    status: `created ${result.name} result`,
  }));
  return result.id;
}
