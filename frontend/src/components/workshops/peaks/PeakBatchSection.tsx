import { useCallback } from "react";

import { findPeaks } from "../../../lib/api/peaks";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import { peakInputs } from "./peakInputs";
import { findOverrides, type PeakFindParams } from "./peakFindParams";

export default function PeakBatchSection({ params }: { params: PeakFindParams }) {
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    const inputs = peakInputs(dataset, selection.xKey, selection.yKeys, null, selection);
    if (!inputs.x.length) throw new Error("No finite X/Y pairs are available to analyze.");
    const xrdDefaults = dataset.data.metadata.technique === "xrd.powder" ? { strict_prominence: true } : {};
    const response = await findPeaks({ x: inputs.x, y: inputs.y, ...xrdDefaults, ...findOverrides(params) });
    const strongest = response.peaks.reduce<typeof response.peaks[number] | null>(
      (best, peak) => !best || peak.prominence > best.prominence ? peak : best,
      null,
    );
    const warnings: string[] = [];
    if (inputs.gapCount) warnings.push(`${inputs.gapCount} gap rows were omitted.`);
    return {
      values: [response.peaks.length, strongest?.center ?? null, strongest?.localSNR ?? null],
      warnings,
    };
  }, [params]);

  return <AnalysisBatchControls
    toolId="peaks"
    label="Peak detection"
    summaryColumns={["Peaks", "Strongest center", "Strongest SNR"]}
    runItem={runItem}
  />;
}
