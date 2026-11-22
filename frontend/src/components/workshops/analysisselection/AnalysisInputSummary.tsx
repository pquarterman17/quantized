// The shared one-line input summary: what the tool analyses and the exact row
// policy (lib/analysisInputs). A refusal renders as the reason, never as a
// silently empty result.

import { analysisInputSummary, analysisRowPolicyNote, type AnalysisInputs } from "../../../lib/analysisInputs";
import "./analysisInputReview.css";

export default function AnalysisInputSummary({ inputs }: { inputs: AnalysisInputs }) {
  return (
    <div className={`qzk-analysis-input-line${inputs.ok ? "" : " blocked"}`} aria-label="Analysis input" data-refusal={inputs.ok ? undefined : inputs.code}>
      <span>{analysisInputSummary(inputs)}</span>
      <span className="qzk-analysis-input-line-note">{analysisRowPolicyNote(inputs)}</span>
    </div>
  );
}
