import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import {
  outlierScreeningAnalysisResult, outlierScreeningRecipe, sameOutlierScreeningQuestion,
  type OutlierScreeningRecipe, type OutlierScreeningSnapshot,
} from "../lib/outlierScreeningAnalysisResult";
import type { AnalysisResult } from "../lib/analysisResult";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

export function matchesOutlierScreeningResult(
  result: AnalysisResult, sourceId: string, sourceFingerprint: string, recipe: OutlierScreeningRecipe,
): boolean {
  const saved = outlierScreeningRecipe(result);
  return !result.stale && result.sources[0]?.datasetId === sourceId &&
    result.sourceFingerprint === sourceFingerprint && !!saved && sameOutlierScreeningQuestion(saved, recipe);
}

export function publishOutlierScreeningResult(
  source: Dataset, recipe: OutlierScreeningRecipe, snapshot: OutlierScreeningSnapshot,
): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source)) {
    state.setStatus("the outlier-screening source changed or its full worksheet is not loaded; run the current screen before saving");
    return null;
  }
  const fingerprint = analysisDataFingerprint(live);
  if (state.analysisResults.some((result) => matchesOutlierScreeningResult(result, live.id, fingerprint, recipe))) {
    state.setStatus("this outlier-screening result is already saved");
    return null;
  }
  const result = outlierScreeningAnalysisResult(nextAnalysisResultId(), live, recipe, snapshot);
  state.recordHistory("save outlier-screening result");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result], status: `created ${result.name} result`,
  }));
  return result.id;
}
