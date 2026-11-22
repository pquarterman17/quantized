// "Review inputs" for the own-pick statistics tools. These tools keep their
// column picks and settings in their own panel, so the card is read-only: it
// shows the shared input line and row-policy note (AnalysisInputSummary, so the
// same refusals incl. lazy-load and load-failed) plus the picks/settings the
// next run will use. `inputs` is null only for a tool state that reads no
// worksheet data (the power test); the card then says so instead of guessing.

import { useState } from "react";

import type { AnalysisInputs } from "../../../lib/analysisInputs";
import AnalysisInputSummary from "./AnalysisInputSummary";
import type { ReviewRow } from "./statsInputReviewRows";
import "./analysisInputReview.css";

interface Props {
  inputs: AnalysisInputs | null;
  rows: readonly ReviewRow[];
}

export default function StatsInputReview({ inputs, rows }: Props) {
  const [open, setOpen] = useState(true);
  const blocked = inputs !== null && !inputs.ok;
  return (
    <section className="qzk-analysis-input-review" aria-label="Review analysis inputs">
      <button type="button" className="qzk-analysis-input-review-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>Review inputs</span>
        <span>{blocked ? "blocked" : open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="qzk-analysis-input-review-body">
          {inputs
            ? <AnalysisInputSummary inputs={inputs} />
            : <p className="qzk-analysis-input-line-note" data-testid="review-no-data">This test reads no worksheet data; it runs on the settings below.</p>}
          <dl className="qzk-analysis-input-picks" aria-label="Tool picks and settings">
            {rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
