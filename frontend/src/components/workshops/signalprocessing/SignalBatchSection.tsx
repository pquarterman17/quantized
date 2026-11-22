// Signal Processing over the shared AnalysisSelection contract: Review inputs
// plus a batch that runs the configured operation on every selected worksheet
// (each worksheet's own selected signal channels, rows and X range) and
// records one comparable result table. Summary-only: Create new worksheet and
// the Library "Apply to selected" recipe path still write the outputs.

import { useCallback } from "react";

import { analysisSelectionData, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";
import { measuredChannels, operationLabel, type SignalSettings } from "./signalProcessingModel";
import { runSignalOn, SIGNAL_SUMMARY_HEADERS, signalSummary } from "./signalRun";
import type { SpectralUiSettings } from "./spectralSettings";

interface Props {
  settings: SignalSettings;
  spectral: SpectralUiSettings;
  /** Why a batch cannot run with this setup (filters, cross-worksheet, invalid settings). */
  blockedReason: string | null;
}

export default function SignalBatchSection({ settings, spectral, blockedReason }: Props) {
  useToolAnalysisSelection("signal-processing"); // seeds / keeps this tool's selection
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    const measured = new Set(measuredChannels(dataset));
    const channels = selection.yKeys.filter((channel) => measured.has(channel));
    if (channels.length === 0) throw new Error("No measured signal column is selected on this worksheet.");
    const out = await runSignalOn(settings, spectral, channels, dataset, analysisSelectionData(dataset, selection));
    return { values: signalSummary(out) };
  }, [settings, spectral]);
  // The batch has its own row policy (exclusions left out), so the single-run
  // "Use excluded/filtered rows" choice is not recorded as if it applied.
  const { useAllRows: _singleRunRows, ...batchSettings } = settings;
  return <>
    <AnalysisInputReview toolId="signal-processing" supportsBatch heading="Input for batch runs" />
    {blockedReason && <p className="qzk-analysis-input-issue error">{blockedReason}</p>}
    <AnalysisBatchControls
      toolId="signal-processing"
      label={operationLabel(settings.operation)}
      summaryColumns={[...SIGNAL_SUMMARY_HEADERS]}
      resultParameters={{ operation: settings.operation, settings: JSON.stringify(batchSettings) }}
      blockedReason={blockedReason}
      runItem={runItem}
    />
  </>;
}
