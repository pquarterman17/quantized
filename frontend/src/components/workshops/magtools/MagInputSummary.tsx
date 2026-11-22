// The magnetometry tools' line of the shared input contract
// (lib/analysisInputs): the plotted moment against its own X. Background,
// Units and Internal field convert EVERY worksheet row (the outputs are
// row-aligned with their source), so they state the full-worksheet policy;
// Curie-Weiss fits the analysis view. The data paths are unchanged.

import { ROW_POLICY } from "../../../lib/analysisInputs";
import { plottedYKey } from "../../../lib/fitselectionActions";
import { ownXKey } from "../../../lib/perSeriesX";
import { useActiveDataset, useApp } from "../../../store/useApp";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";

export default function MagInputSummary({ analysisView }: { analysisView: boolean }) {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  // magXY's own fallback: the first channel when nothing is plotted.
  const yKey = active ? plottedYKey(active, xKey, yKeys, seriesOrder) ?? 0 : 0;
  const inputs = useAnalysisInputs({
    xKey: active ? ownXKey(active, xKey, yKey) : null,
    yKeys: [yKey],
    policy: analysisView ? ROW_POLICY.analysisView : ROW_POLICY.fullWorksheet,
  });
  return active ? <AnalysisInputSummary inputs={inputs} /> : null;
}
