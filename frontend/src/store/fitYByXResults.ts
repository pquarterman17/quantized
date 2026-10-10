import { fitYByXAnalysisResult, type FitYByXRecipe, type FitYByXSnapshot } from "../lib/fitYByXAnalysisResult";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

export function hasFitYByXResult(id: string): boolean {
  return useApp.getState().analysisResults.some((result) => result.id === id);
}

export function publishFitYByXResult(source: Dataset, recipe: FitYByXRecipe, snapshot: FitYByXSnapshot): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source)) {
    state.setStatus("the Fit Y by X source changed or its full worksheet is not loaded; wait for the current analysis before saving");
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
