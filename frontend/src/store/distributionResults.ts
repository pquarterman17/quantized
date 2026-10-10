import { distributionAnalysisResult, type DistributionRecipe, type DistributionSnapshot } from "../lib/distributionAnalysisResult";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

export function hasDistributionResult(id: string): boolean {
  return useApp.getState().analysisResults.some((result) => result.id === id);
}

export function publishDistributionResult(source: Dataset, recipe: DistributionRecipe, snapshot: DistributionSnapshot): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source)) {
    useApp.getState().setStatus("the Distribution source changed or its full worksheet is not loaded; wait for the current analysis before saving");
    return null;
  }
  const result = distributionAnalysisResult(nextAnalysisResultId(), live, recipe, snapshot);
  state.recordHistory("save distribution result");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result],
    status: `created ${result.name} result`,
  }));
  return result.id;
}
