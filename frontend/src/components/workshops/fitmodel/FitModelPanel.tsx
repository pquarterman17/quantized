// Fit Model (GAP_AUDIT_9 G1, JMP Fit Model / Standard Least Squares): view.
// A response on any mix of continuous and nominal factors, crossed and
// polynomial terms; the report is the shared result book. Thin: model
// building is ModelBuilder (pure ops in lib/fitModel), fitting and the row
// contract are useFitModel, the numbers are calc/stats_linear_model.py.

import ToolWindow from "../../overlays/ToolWindow";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { useFitModelStore } from "../../../store/fitModel";
import FitModelResultBook from "./FitModelResultBook";
import ModelBuilder from "./ModelBuilder";
import { useFitModel } from "./useFitModel";

export default function FitModelPanel() {
  const setOpen = useFitModelStore((s) => s.setOpen);
  const m = useFitModel();
  const note = (text: string, warn = false) => (
    <div className="qzk-ds-meta" role={warn ? "alert" : undefined}
      style={{ marginTop: 10, color: warn ? "var(--warn, var(--text-faint))" : "var(--text-faint)" }}>
      {text}
    </div>
  );
  return (
    <ToolWindow id="fit-model" title="Fit model" width={620} onClose={() => setOpen(false)}>
      {!m.hasData ? note("Select a dataset to analyze.") : (
        <>
          <StatsInputReview inputs={m.inputs} rows={[
            { label: "Response (Y)", value: m.labelOf(m.responseCol) },
            { label: "Effects", value: m.termLabels.length ? m.termLabels.join(", ") : "none yet" },
            { label: "Center polynomials", value: m.center ? "yes" : "no" },
          ]} />
          <ModelBuilder m={m} />
          {m.problem && note(m.problem)}
          {!m.problem && m.busy && note("fitting…")}
          {!m.problem && m.error && note(m.error, true)}
          {!m.problem && !m.error && m.fit && (
            <div style={{ marginTop: 10 }}>
              <FitModelResultBook m={m} />
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
