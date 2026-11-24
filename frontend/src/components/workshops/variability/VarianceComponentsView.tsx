// Variability chart (JMP_GAP_PLAN J8) — the nested-ANOVA table + the
// ANOVA/EMS variance-components table (with the negative-clamped-to-0 /
// non-estimable disclosures the backend already carries — never hidden).
// Since lane RB3 each piece is its own result-book section body (the panel
// supplies the section titles), so these render no headings of their own.

import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";
import { StatusDot } from "../../primitives";
import type { NestedAnovaResponse, VarianceComponentsResponse, VariabilitySummaryResponse } from "./useVariability";

/** The summary line: the observations, the grand mean, and how A was tested. */
export function VariabilitySummaryLine({ anova, summary }: { anova: NestedAnovaResponse; summary: VariabilitySummaryResponse }) {
  return (
    <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
      N = {summary.grand_n}, grand mean {fmtNum(summary.grand_mean)}. A tested against {anova.a_tested_against}
      {!anova.b_within_a_estimable && " (B(A) not estimable — every A level has exactly one B-subgroup)"}
      {anova.balanced ? " — balanced design" : " — unbalanced design"}
    </div>
  );
}

export function NestedAnovaTable({ anova }: { anova: NestedAnovaResponse }) {
  return (
    <DataTable
      columns={["Source", "SS", "df", "MS", "F", "p"]}
      rows={anova.table.map((r) => [r.source, fmtNum(r.SS), String(r.df), fmtNum(r.MS), fmtNum(r.F), fmtNum(r.p)])}
    />
  );
}

export function VarianceComponentsTable({ varComp }: { varComp: VarianceComponentsResponse }) {
  return (
    <>
      <DataTable
        columns={["Component", "sigma²", "% of total"]}
        rows={[
          ["A", fmtNum(varComp.sigma2_A), fmtNum(varComp.pct_A)],
          ["B(A)", fmtNum(varComp.sigma2_B_within_A), fmtNum(varComp.pct_B_within_A)],
          ["Error", fmtNum(varComp.sigma2_error), fmtNum(varComp.pct_error)],
        ]}
      />
      {(varComp.clamped.A || varComp.clamped.B_within_A || varComp.clamped.error) && (
        <div style={{ marginTop: 6 }}>
          <StatusDot
            tone="warn"
            label={`negative raw estimate clamped to 0 for: ${[
              varComp.clamped.A && "A",
              varComp.clamped.B_within_A && "B(A)",
              varComp.clamped.error && "Error",
            ]
              .filter(Boolean)
              .join(", ")}`}
          />
        </div>
      )}
    </>
  );
}
