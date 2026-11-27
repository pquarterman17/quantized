// Baseline's line of the shared input contract (lib/analysisInputs): the
// plotted channel against its own X, over EVERY row of the worksheet (the
// estimate has never dropped excluded or filtered-out rows). The estimate reads
// its rows through the same resolver call (`baselineInput`).
//
// A row range does NOT narrow the single Estimate, and the line says so: the
// estimate is drawn and subtracted row-for-row against the whole worksheet (the
// overlay and "Subtract" refuse any baseline whose length is not the sheet's),
// and a baseline fitted to a window cannot be evaluated for the rows outside it.
// The batch table below honours the range through its own input review.

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
