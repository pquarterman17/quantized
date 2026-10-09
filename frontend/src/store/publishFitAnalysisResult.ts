// Lazy producer-side bridge: workshops call this immediately after setFitSpec
// so the durable Library result lands in the same user gesture. Kept out of
// recalcEngine because workspace migration code must not enter app startup.

import { fitAnalysisResult, isFitResultForDataset } from "../lib/fitAnalysisResult";
import { useApp } from "./useApp";

export function publishFitAnalysisResult(datasetId: string): void {
  useApp.setState((state) => {
    const dataset = state.datasets.find((item) => item.id === datasetId);
    if (!dataset?.fitSpec) return {};
    const spec = dataset.fitSpec;
    const linked = state.analysisResults.filter((result) => isFitResultForDataset(result, datasetId));
    if (!linked.length) return {
      analysisResults: [...state.analysisResults, fitAnalysisResult(dataset, spec)],
      staleFits: state.staleFits.filter((id) => id !== datasetId),
    };
    return {
      analysisResults: state.analysisResults.map((result) => {
        if (!isFitResultForDataset(result, datasetId)) return result;
        const fresh = fitAnalysisResult(dataset, spec, result.createdAt);
        return {
          ...fresh, id: result.id, name: result.name, createdAt: result.createdAt,
          ...(result.notes ? { notes: result.notes } : {}),
        };
      }),
      staleFits: state.staleFits.filter((id) => id !== datasetId),
    };
  });
}
