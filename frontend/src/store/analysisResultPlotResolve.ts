import { liveFitPlotBinding } from "../lib/fitAnalysisResultLive";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

export interface PreparedAnalysisResultPlot {
  dataset: Dataset;
  channels: number[];
  xChannel?: number | null;
}

/** Resolve a result binding without changing the plot. Fitted output follows
 * the live FitSpec; source-only builders may fall back to the saved binding
 * after a fit is removed. */
export async function resolveAnalysisResultPlot(
  id: string,
  bindingIndex: number,
  sourceOnly = false,
): Promise<PreparedAnalysisResultPlot | null> {
  const initial = useApp.getState();
  const result = initial.analysisResults.find((item) => item.id === id);
  const fitDatasetId = result?.settingsRef?.field === "fitSpec" && bindingIndex === 0
    ? result.settingsRef.datasetId
    : null;
  const binding = result?.plotBindings?.[bindingIndex];
  const datasetId = fitDatasetId ?? binding?.datasetId;
  if (!result || !datasetId) {
    initial.setStatus("can't open result figure: the saved plot binding is unavailable");
    return null;
  }
  try {
    await initial.resolveDataset(datasetId);
  } catch (error) {
    useApp.getState().setStatus(`can't open result figure: ${error instanceof Error ? error.message : "worksheet loading failed"}`);
    return null;
  }
  const state = useApp.getState();
  const currentResult = state.analysisResults.find((item) => item.id === id);
  const fitDataset = fitDatasetId ? state.datasets.find((item) => item.id === fitDatasetId) : null;
  if (fitDatasetId) {
    if (currentResult?.settingsRef?.field !== "fitSpec" || currentResult.settingsRef.datasetId !== fitDatasetId) {
      state.setStatus("can't open result figure: its result changed while loading");
      return null;
    }
    const liveBinding = currentResult && fitDataset ? liveFitPlotBinding(currentResult, fitDataset) : null;
    if (liveBinding) {
      return { dataset: fitDataset!, channels: liveBinding.channels, xChannel: liveBinding.xChannel };
    }
    if (!sourceOnly) {
      state.setStatus(`can't open result figure: ${fitDataset && !fitDataset.fitSpec
        ? "the saved fit is missing"
        : fitDataset ? "its live fit channels are unavailable" : "its worksheet is missing"}`);
      return null;
    }
  }
  if (!binding) {
    state.setStatus("can't open result figure: the saved plot binding is unavailable");
    return null;
  }
  const currentBinding = currentResult?.plotBindings?.[bindingIndex];
  if (!currentBinding || currentBinding.datasetId !== binding.datasetId ||
      currentBinding.xChannel !== binding.xChannel ||
      currentBinding.channels.length !== binding.channels.length ||
      currentBinding.channels.some((channel, index) => channel !== binding.channels[index])) {
    state.setStatus("can't open result figure: the saved plot binding changed while loading");
    return null;
  }
  const dataset = state.datasets.find((item) => item.id === currentBinding.datasetId);
  const channels = dataset
    ? [...new Set(currentBinding.channels)].filter((channel) => Number.isInteger(channel) && channel >= 0 && channel < dataset.data.labels.length)
    : [];
  const xChannel = currentBinding.xChannel;
  const xValid = xChannel === undefined || xChannel === null ||
    (Number.isInteger(xChannel) && xChannel >= 0 && xChannel < (dataset?.data.labels.length ?? 0));
  if (!dataset || channels.length === 0 || !xValid) {
    state.setStatus(`can't open result figure: ${dataset ? "its plotted channels are unavailable" : "its worksheet is missing"}`);
    return null;
  }
  return { dataset, channels, ...(xChannel !== undefined ? { xChannel } : {}) };
}
