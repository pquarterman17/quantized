// Signal Processing's line of the shared input contract (lib/analysisInputs):
// the active worksheet, its X/time axis, the picked signal columns, and the
// FULL-worksheet row policy this tool has always used (excluded and
// filtered-out rows are processed too), stated rather than changed.

import { ROW_POLICY } from "../../../lib/analysisInputs";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";

export default function SignalInputSummary({ channels }: { channels: readonly number[] }) {
  const inputs = useAnalysisInputs({ xKey: null, yKeys: channels, policy: ROW_POLICY.fullWorksheet });
  return <AnalysisInputSummary inputs={inputs} />;
}
