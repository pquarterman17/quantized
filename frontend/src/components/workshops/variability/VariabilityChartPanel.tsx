// Variability chart + variance components workbench (JMP_GAP_PLAN J8) —
// view. Pick a Response (continuous), Factor A (outer nesting), and Factor B
// (inner, nested-in-A) column; renders the chart (cells/points/connect-means/
// group-mean/grand-mean) plus the nested-ANOVA and variance-components
// tables, as one result book (lane RB3). Thin — the grouping math + fetching live in useVariability; the
// chart and tables are their own sub-components.

import ToolWindow from "../../overlays/ToolWindow";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { variabilityRows } from "../analysisselection/statsInputReviewRows";
import { Select } from "../../primitives";
import { useVariabilityStore } from "../../../store/variability";
import VariabilityResultBook from "./VariabilityResultBook";
import { useVariability } from "./useVariability";

export default function VariabilityChartPanel() {
  const setOpen = useVariabilityStore((s) => s.setOpen);
  const v = useVariability();
  const colOptions = v.columns.map((c) => ({ value: String(c.index), label: c.label }));

  return (
    <ToolWindow id="variability" title="Variability chart" width={520} onClose={() => setOpen(false)}>
      {!v.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset to analyze.
        </div>
      ) : (
        <>
          <StatsInputReview inputs={v.inputs} rows={variabilityRows(v.inputs, { response: v.responseCol, a: v.factorACol, b: v.factorBCol })} />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Response (Y)</label>
              <Select
                aria-label="Response (Y)"
                options={colOptions}
                value={String(v.responseCol)}
                onChange={(e) => v.setResponseCol(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Factor A (outer)</label>
              <Select
                aria-label="Factor A (outer)"
                options={colOptions}
                value={String(v.factorACol)}
                onChange={(e) => v.setFactorACol(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Factor B (nested in A)</label>
              <Select
                aria-label="Factor B (nested in A)"
                options={colOptions}
                value={String(v.factorBCol)}
                onChange={(e) => v.setFactorBCol(Number(e.target.value))}
              />
            </div>
          </div>

          {v.busy && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              analyzing…
            </div>
          )}

          {v.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--warn, var(--text-faint))" }}>
              {v.error}
            </div>
          )}

          {!v.busy && !v.error && v.summary && v.anova && (
            <div style={{ marginTop: 10 }}>
              <VariabilityResultBook v={v} />
            </div>
          )}

          {v.saveResultDisabledReason && v.anova && v.summary && (
            <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
              {v.saveResultDisabledReason}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
