// Before-run summary of a custom equation (audit P2.7): what the parser —
// the same no-eval RPN interpreter that will evaluate the fit — recognised in
// the text, BEFORE anything runs. The independent variable x (and a warning
// when the equation never uses it), the parameters split free / held, and the
// built-in constants and functions it matched. A name the user meant as a
// constant but misspelled ("Pi") shows up here as a free parameter, which is
// the mistake this summary exists to catch.

import type { ReactNode } from "react";

import type { EquationParamRow } from "../../../lib/equationRows";
import type { EquationSummary as Summary } from "./useEquationFit";

interface Props {
  summary: Summary;
  rows: readonly EquationParamRow[];
  /** Why the fit cannot run as the table stands, or null. */
  runProblem: string | null;
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ width: 72, flexShrink: 0, color: "var(--text-faint)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{children}</span>
    </div>
  );
}

export default function EquationSummary({ summary, rows, runProblem }: Props) {
  const free = rows.filter((r) => !r.fixed).map((r) => r.name);
  const held = rows.filter((r) => r.fixed).map((r) => r.name);
  return (
    <div
      className="qzk-ds-meta qzk-msg"
      style={{ marginTop: 6, display: "grid", gap: 2 }}
      aria-label="equation summary"
    >
      <Line label="variable">
        {summary.usesX ? (
          `${summary.variable} (independent)`
        ) : (
          <span style={{ color: "var(--warn)" }}>
            {summary.variable} is not used — the model is a constant
          </span>
        )}
      </Line>
      <Line label="free">{free.length > 0 ? free.join(", ") : "none"}</Line>
      {held.length > 0 && <Line label="held">{held.join(", ")}</Line>}
      {summary.constants.length > 0 && <Line label="constants">{summary.constants.join(", ")}</Line>}
      {summary.functions.length > 0 && <Line label="functions">{summary.functions.join(", ")}</Line>}
      {runProblem && (
        <div role="alert" style={{ color: "var(--danger)" }}>
          {runProblem}
        </div>
      )}
    </div>
  );
}
