// Lazy producer-side bridge: workshops call this immediately after setFitSpec
// so the durable Library result lands in the same user gesture. Kept out of
// recalcEngine because workspace migration code must not enter app startup.

import { refreshFitAnalysisResults } from "../lib/fitAnalysisResultLive";
import { useApp } from "./useApp";

export function publishFitAnalysisResult(datasetId: string): void {
  useApp.setState((state) => {
    const dataset = state.datasets.find((item) => item.id === datasetId);
    if (!dataset?.fitSpec) return {};
    return {
      analysisResults: refreshFitAnalysisResults(state.analysisResults, dataset),
      staleFits: state.staleFits.filter((id) => id !== datasetId),
    };
  });
}
