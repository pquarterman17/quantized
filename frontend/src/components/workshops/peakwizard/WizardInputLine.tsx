// The Peak wizard's input line: the shared analysis-input line's look
// (analysisselection/analysisInputReview.css), carrying the wizard's own fit
// range and gap-row drop, or the reason there is nothing to fit.

import "../analysisselection/analysisInputReview.css";
import type { WizardInputLine as Line } from "./wizardSegment";

export default function WizardInputLine({ line }: { line: Line }) {
  return (
    <div
      className={`qzk-analysis-input-line${line.refusal ? " blocked" : ""}`}
      aria-label="Analysis input"
      data-refusal={line.refusal ? "refused" : undefined}
    >
      <span>{line.text}</span>
      <span className="qzk-analysis-input-line-note">{line.note}</span>
    </div>
  );
}
