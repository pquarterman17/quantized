// "Go to source rows" beside a saved result's "Input rows" line (ROW_RANGE_CONTRACT 3.3, OG20): selects the rows the
// result read WHEN IT WAS SAVED in the source worksheet, through the same open-with-rows path as every Go to Source.
// Disabled with the reason when the source changed since (the rows may have moved). Renders nothing for a result that
// recorded no range.

import { useMemo } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { planRecordedRanges } from "../../../lib/recordedRangeNav";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

export default function RecordedRowsGoTo({ result, outputMetadata, onDone }: {
  result: AnalysisResult;
  outputMetadata?: Readonly<Record<string, unknown>>;
  /** Called after the rows were selected (the panel closes itself so the worksheet is in view). */
  onDone?: () => void;
}) {
  const datasets = useApp((s) => s.datasets);
  const plans = useMemo(() => planRecordedRanges(result, outputMetadata, datasets), [result, outputMetadata, datasets]);
  return <>{plans.map((plan) => (
    <Button key={plan.datasetId} size="sm" disabled={!plan.ok}
      title={plan.ok ? `Open “${plan.sourceName}” with ${plan.label} selected, the rows this result read when it was saved` : plan.reason}
      onClick={() => {
        if (!plan.ok) return;
        void runLazy("Opening the source…", () => import("../../../store/recordedRangeNav")).then((m) => { m.goToRecordedRows(plan); onDone?.(); }, onLoadFailure);
      }}>Go to source rows</Button>
  ))}</>;
}
