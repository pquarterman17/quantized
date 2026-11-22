// Ellipse fit over the shared AnalysisSelection contract: the chosen fit kind
// (direct algebraic or orthogonal) applied to every selected worksheet's
// reviewed X and Y, one summary table (centre, semi-axes, tilt, RMS, arc
// coverage) recorded. Summary-only: "Add fitted ellipse" still writes the
// active worksheet's curve.

import { useCallback } from "react";

import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";
import { batchColumns, batchPicks } from "../analysisextras/batchColumns";
import { ELLIPSE_SUMMARY_HEADERS, runEllipse } from "./ellipseRun";

export default function EllipseFitBatchSection({ geometric }: { geometric: boolean }) {
  useToolAnalysisSelection("ellipse-fit");
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    const [x, y] = batchColumns(dataset, selection, batchPicks(dataset, selection, 1));
    return runEllipse(x!, y!, geometric);
  }, [geometric]);
  return <>
    <AnalysisInputReview toolId="ellipse-fit" singleY supportsBatch />
    <AnalysisBatchControls
      toolId="ellipse-fit"
      label="Ellipse fit"
      summaryColumns={[...ELLIPSE_SUMMARY_HEADERS]}
      resultParameters={{ geometric }}
      runItem={runItem}
    />
  </>;
}
