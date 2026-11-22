// Signal Processing's line of the shared input contract (lib/analysisInputs):
// the active worksheet, its X/time axis, the picked signal columns and the row
// policy of the single run. By default that is the FULL worksheet (excluded and
// filtered-out rows are processed too, as this tool has always done); the
// "Use excluded/filtered rows" option off switches to the analysis view.

import { ROW_POLICY } from "../../../lib/analysisInputs";
import { Checkbox } from "../../primitives/Checkbox";
import AnalysisInputSummary from "../analysisselection/AnalysisInputSummary";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";

interface Props {
  channels: readonly number[];
  useAllRows: boolean;
  onUseAllRows: (value: boolean) => void;
}

export default function SignalInputSummary({ channels, useAllRows, onUseAllRows }: Props) {
  const inputs = useAnalysisInputs({
    xKey: null, yKeys: channels, policy: useAllRows ? ROW_POLICY.fullWorksheet : ROW_POLICY.analysisView,
  });
  return (
    <>
      <AnalysisInputSummary inputs={inputs} />
      <Checkbox checked={useAllRows} onChange={onUseAllRows}>Use excluded/filtered rows</Checkbox>
    </>
  );
}
