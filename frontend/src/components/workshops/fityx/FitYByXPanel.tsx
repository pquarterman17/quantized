// Fit Y by X workbench (JMP_GAP_PLAN J3) — view. Pick an X and a Y column;
// the panel dispatches on their modeling types and renders the matching leg
// (oneway / bivariate / contingency). Thin — the dispatch math + fetching
// live in useFitYByX; each leg's display is its own sub-component.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { useFitYByXStore } from "../../../store/fitYByX";
import BivariateView from "./BivariateView";
import ContingencyView from "./ContingencyView";
import FitYByXLevelSection from "./FitYByXLevelSection";
import OnewayView from "./OnewayView";
import { useFitYByX } from "./useFitYByX";

const KIND_LABEL: Record<string, string> = {
  oneway: "Oneway (categorical X, continuous Y)",
  bivariate: "Bivariate fit (continuous X, continuous Y)",
  contingency: "Contingency (categorical X, categorical Y)",
  unsupported: "Not supported",
};

export default function FitYByXPanel() {
  const setOpen = useFitYByXStore((s) => s.setOpen);
  const f = useFitYByX();
  const colOptions = f.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const byActive = f.byLevels.length > 0;

  return (
    <ToolWindow id="fit-y-by-x" title="Fit Y by X" width={420} onClose={() => setOpen(false)}>
      {!f.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to analyze.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">X (factor)</label>
              <Select
                aria-label="X (factor)"
                options={colOptions}
                value={String(f.xCol)}
                onChange={(e) => f.setXCol(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Y (response)</label>
              <Select
                aria-label="Y (response)"
                options={colOptions}
                value={String(f.yCol)}
                onChange={(e) => f.setYCol(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            {KIND_LABEL[f.kind]}
          </div>

          {f.kind === "bivariate" && (
            <div style={{ marginTop: 8 }}>
              <label className="qzk-field-lbl">Order</label>
              <Select
                options={[1, 2, 3].map((o) => ({ value: String(o), label: o === 1 ? "1 (linear)" : String(o) }))}
                value={String(f.order)}
                onChange={(e) => f.setOrder(Number(e.target.value))}
              />
            </div>
          )}

          {/* By-column partitioning (JMP_GAP_PLAN J7): run this leg once
              per level of an optional categorical column, render-only —
              never writes the shared row selection. */}
          {f.byOptions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <label className="qzk-field-lbl">By (optional)</label>
              <Select
                aria-label="By (optional)"
                options={[{ value: "", label: "None" }, ...f.byOptions.map((c) => ({ value: String(c.index), label: c.label }))]}
                value={f.byCol == null ? "" : String(f.byCol)}
                onChange={(e) => f.setByCol(e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          )}

          {f.busy && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              analyzing…
            </div>
          )}

          {f.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--warn, var(--text-faint))" }}>
              {f.error}
            </div>
          )}

          {byActive ? (
            <>
              {f.byBusy && f.byResults.length === 0 ? (
                <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
                  analyzing {f.byLevels.length} levels…
                </div>
              ) : (
                f.byResults.map((r) => <FitYByXLevelSection key={r.label} result={r} kind={f.kind} />)
              )}
            </>
          ) : (
            <>
              {!f.busy && !f.error && f.kind === "oneway" && f.oneway && <OnewayView result={f.oneway} />}
              {!f.busy && !f.error && f.kind === "bivariate" && f.bivariate && <BivariateView result={f.bivariate} />}
              {!f.busy && !f.error && f.kind === "contingency" && f.contingency && (
                <ContingencyView result={f.contingency} />
              )}
            </>
          )}

          {(byActive ? f.byResults.length > 0 : !!(f.oneway || f.bivariate || f.contingency)) && (
            <div style={{ marginTop: 12 }}>
              <Button size="sm" disabled={f.reportBusy} onClick={() => void f.toReport()}>
                {f.reportBusy ? "Reporting…" : "→ Report"}
              </Button>
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
