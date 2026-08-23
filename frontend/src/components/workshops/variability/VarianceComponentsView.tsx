// Variability chart (JMP_GAP_PLAN J8) — the nested-ANOVA table + the
// ANOVA/EMS variance-components table (with the negative-clamped-to-0 /
// non-estimable disclosures the backend already carries — never hidden).

import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";
import { StatusDot } from "../../primitives";
import type { NestedAnovaResponse, VarianceComponentsResponse } from "./useVariability";

export default function VarianceComponentsView({
  anova,
  varComp,
  varCompNote,
}: {
  anova: NestedAnovaResponse;
  varComp: VarianceComponentsResponse | null;
  varCompNote: string | null;
}) {
  return (
    <>
      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <div className="qzk-field-lbl">Nested ANOVA</div>
        <DataTable
          columns={["Source", "SS", "df", "MS", "F", "p"]}
          rows={anova.table.map((r) => [r.source, fmtNum(r.SS), String(r.df), fmtNum(r.MS), fmtNum(r.F), fmtNum(r.p)])}
        />
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
        A tested against {anova.a_tested_against}
        {!anova.b_within_a_estimable && " (B(A) not estimable — every A level has exactly one B-subgroup)"}
        {anova.balanced ? " — balanced design" : " — unbalanced design"}
      </div>

      {varComp ? (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <div className="qzk-field-lbl">Variance components ({varComp.method})</div>
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
        </div>
      ) : (
        varCompNote && (
          <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
            {varCompNote}
          </div>
        )
      )}
    </>
  );
}
