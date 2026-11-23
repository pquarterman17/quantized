// Baseline's line of the shared input contract (lib/analysisInputs): the
// plotted channel against its own X, over EVERY row of the worksheet (the
// estimate has never dropped excluded or filtered-out rows). The estimate reads
// its rows through the same resolver call (`baselineInput`).

import { ROW_POLICY } from "../../../lib/analysisInputs";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import type { BaselineBinding } from "./useBaseline";

export default function BaselineInputSummary({ binding }: { binding: BaselineBinding | null }) {
  const inputs = useAnalysisInputs({
    xKey: binding?.xKey ?? null, yKeys: binding ? [binding.yKey] : [], policy: ROW_POLICY.fullWorksheet,
  });
  return binding ? <AnalysisInputSummary inputs={inputs} /> : null;
}
