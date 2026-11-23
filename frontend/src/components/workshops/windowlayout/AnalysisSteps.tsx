// The Analysis guide's five steps (WORKSPACE_LAYOUT_PLAN P4): Inspect -> Clean
// -> Plot -> Analyze -> Report, each with its status (not started, done, out of
// date) and a one-sentence reason; the next step is highlighted. Clicking a
// step reopens it: the Data window, the data filter, the saved figure (or the
// figure setup), the latest result (or the tool list) and the report.

import { useId } from "react";

import type { GuideStep, StepStatus } from "../../../lib/windowLayout/analysisGuide";
import { runStep } from "../../../store/analysisWindowActions";
import { useApp } from "../../../store/useApp";
import { announce } from "./layoutAnnounce";

const STATUS: Record<StepStatus, { glyph: string; text: string }> = {
  "not-started": { glyph: "○", text: "Not started" },
  done: { glyph: "✓", text: "Done" },
  "out-of-date": { glyph: "⚠", text: "Out of date" },
};

export default function AnalysisSteps({ datasetId, steps, onTools }: { datasetId: string; steps: readonly GuideStep[]; onTools: () => void }) {
  const headingId = useId();
  const setStatus = useApp((s) => s.setStatus);
  const open = (step: GuideStep) => {
    const out = runStep(step.id, datasetId);
    if (out === "tools") return onTools();
    if (out) {
      setStatus(out, "warn");
      announce(out);
    }
  };
  return (
    <section className="qzk-wl-an-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="qzk-wl-an-heading">
        Steps
      </h3>
      <ol className="qzk-wl-an-steps">
        {steps.map((step) => {
          const st = STATUS[step.status];
          return (
            <li key={step.id} className={`qzk-wl-an-step ${step.status}${step.next ? " next" : ""}`} aria-current={step.next ? "step" : undefined}>
              <button type="button" className="qzk-wl-an-stepbtn" title={step.detail} onClick={() => open(step)}>
                <span className="qzk-wl-an-glyph" aria-hidden="true">
                  {st.glyph}
                </span>
                <span className="qzk-wl-an-steplabel">{step.label}</span>
                <span className="qzk-wl-an-status">
                  {st.text}
                  {step.next ? " · next" : ""}
                </span>
              </button>
              <span className="qzk-wl-an-detail">{step.detail}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
