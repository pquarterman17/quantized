// The shared one-line input summary: what the tool analyses and the exact row
// policy (lib/analysisInputs). A refusal renders as the reason, never as a
// silently empty result. A row range the tool honours (set from the worksheet's
// "Use as row range") is stated in the line and can be cleared here, since a
// statistics tool has no row fields of its own.

import { analysisInputSummary, analysisRowPolicyNote, type AnalysisInputs } from "../../../lib/analysisInputs";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { Button } from "../../primitives";
import "./analysisInputReview.css";

export default function AnalysisInputSummary({ inputs }: { inputs: AnalysisInputs }) {
  const updateItem = useAnalysisSelection((state) => state.updateItem);
  // The range is narrowing this input, or emptied (a refusal): either way it can be cleared.
  const ranged = inputs.ok ? inputs.rowRange !== null : inputs.code === "no-rows" && inputs.dataset !== null;
  const datasetId = inputs.dataset?.id ?? null;
  const held = useAnalysisSelection((state) =>
    datasetId !== null && !!state.selection?.items.some((item) => item.datasetId === datasetId && item.rowRange));
  return (
    <div className={`qzk-analysis-input-line${inputs.ok ? "" : " blocked"}`} aria-label="Analysis input" data-refusal={inputs.ok ? undefined : inputs.code}>
      <span>{analysisInputSummary(inputs)}</span>
      <span className="qzk-analysis-input-line-note">{analysisRowPolicyNote(inputs)}</span>
      {ranged && held && datasetId !== null && (
        <Button size="sm" onClick={() => updateItem(datasetId, { rowRange: null })}>Clear row range</Button>
      )}
    </div>
  );
}
