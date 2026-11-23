// The magnetometry tools' line of the shared input contract
// (lib/analysisInputs): the plotted moment against its own X. Background,
// Units and Internal field convert EVERY worksheet row (the outputs are
// row-aligned with their source), so they state the full-worksheet policy;
// Curie-Weiss fits the analysis view. The tools resolve their rows through the
// same resolver and column choice (`./magInputs`), so this line is what they read.

import { ROW_POLICY } from "../../../lib/analysisInputs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import { magColumns } from "./magInputs";

export default function MagInputSummary({ analysisView }: { analysisView: boolean }) {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  // The tools' own column choice (`magColumns`): the first channel when nothing is plotted.
  const cols = active ? magColumns(active, xKey, yKeys, seriesOrder) : null;
  const inputs = useAnalysisInputs({
    xKey: cols ? cols.xKey : null,
    yKeys: [cols ? cols.yKey : 0],
    policy: analysisView ? ROW_POLICY.analysisView : ROW_POLICY.fullWorksheet,
  });
  return active ? <AnalysisInputSummary inputs={inputs} /> : null;
}
