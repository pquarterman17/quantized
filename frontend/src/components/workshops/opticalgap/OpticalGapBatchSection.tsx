// Optical gap over the shared AnalysisSelection contract: the panel's
// quantities, transition and fit window applied to every selected worksheet's
// reviewed X (energy / wavelength) and Y (absorption / transmittance), one
// summary table (Eg, SE, window, R², points) recorded. Summary-only: "Add Tauc
// data" still writes the active worksheet's edge. The batch uses ONE X unit
// and signal kind; a worksheet whose X unit reads differently is flagged.

import { useCallback, useMemo } from "react";

import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";
import { batchColumns, batchPicks } from "../analysisextras/batchColumns";
import { pickUnit } from "../analysisextras/columnPicks";
import { TAUC_SUMMARY_HEADERS, runTauc, taucOptions, type TaucSettings } from "./opticalGapRun";
import { guessXUnit } from "./useOpticalGap";

export default function OpticalGapBatchSection({ g }: { g: TaucSettings }) {
  useToolAnalysisSelection("optical-gap");
  const { xUnit, signal, percent, thickness, kind, eMin, eMax } = g;
  const options = useMemo(
    () => taucOptions({ xUnit, signal, percent, thickness, kind, eMin, eMax }),
    [xUnit, signal, percent, thickness, kind, eMin, eMax],
  );
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    if (typeof options === "string") throw new Error(options);
    const picks = batchPicks(dataset, selection, 1);
    const [x, y] = batchColumns(dataset, selection, picks);
    const { values, warnings } = await runTauc(x!, y!, options);
    const guessed = guessXUnit(pickUnit(dataset.data, picks[0]!), x!);
    if (guessed !== options.x_unit) warnings.push(`This worksheet's X reads as ${guessed}, but the batch uses ${options.x_unit}.`);
    return { values, warnings };
  }, [options]);
  return <>
    <AnalysisInputReview toolId="optical-gap" singleY supportsBatch />
    <p className="qzk-ds-meta">
      The batch applies this X unit, signal, transition and fit window to each worksheet's selected X and Y.
    </p>
    <AnalysisBatchControls
      toolId="optical-gap"
      label="Optical gap"
      summaryColumns={[...TAUC_SUMMARY_HEADERS]}
      resultParameters={{ xUnit, signal, percent, thickness, kind, eMin, eMax }}
      blockedReason={typeof options === "string" ? options : null}
      runItem={runItem}
      settingsKey={JSON.stringify([xUnit, signal, percent, thickness, kind, eMin, eMax])}
    />
  </>;
}
