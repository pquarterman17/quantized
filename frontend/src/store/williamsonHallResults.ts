import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { WilliamsonHallResult } from "../lib/reductionTypes";
import type { Dataset } from "../lib/types";
import { williamsonHallAnalysisResult, type WilliamsonHallRecipe } from "../lib/williamsonHallAnalysisResult";
import { williamsonHallPeakTableFingerprint } from "../lib/williamsonHallRecipe";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

/** Publish only against the exact loaded source used by the request. */
export function publishWilliamsonHallResult(
  source: Dataset, recipe: WilliamsonHallRecipe, output: WilliamsonHallResult,
): string | null {
  const state = useApp.getState();
  const live = state.datasets.find((dataset) => dataset.id === source.id);
  const peakBindingChanged = recipe.sourceKind === "peak-table" &&
    (!live?.peakTable || recipe.peakTableFingerprint !== williamsonHallPeakTableFingerprint(live.peakTable));
  if (!live || live.pending || source.pending || analysisDataFingerprint(live) !== analysisDataFingerprint(source) || peakBindingChanged) {
    state.setStatus("the Williamson–Hall source changed or is not fully loaded; fit again before saving");
    return null;
  }
  const result = williamsonHallAnalysisResult(nextAnalysisResultId(), live, recipe, output);
  state.recordHistory("save Williamson–Hall result");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result],
    openAnalysisResultId: result.id,
    status: `created ${result.name} result`,
  }));
  return result.id;
}
