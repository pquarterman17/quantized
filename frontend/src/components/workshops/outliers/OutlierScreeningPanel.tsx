// Outlier Screening panel (JMP_GAP_PLAN J9 residual) — view. Pick a channel
// + method, read the statistic/critical value/flagged rows, then
// "Select flagged rows" to hand them to the shared #50 selection so the
// existing exclude/keep-only worksheet actions can act on them. NEVER
// auto-excludes — see useOutlierScreening's module doc.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, Select } from "../../primitives";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { OUTLIER_METHODS, useOutlierScreening } from "./useOutlierScreening";

function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
}

export default function OutlierScreeningPanel() {
  const setOpen = useOutlierScreeningStore((s) => s.setOpen);
  const o = useOutlierScreening();
  const colOptions = o.columns.map((c) => ({ value: String(c.index), label: c.label }));

  return (
    <ToolWindow id="outlier-screening" title="Outlier screening" width={420} onClose={() => setOpen(false)}>
      {!o.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to screen.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Channel</label>
              <Select
                aria-label="Channel"
                options={colOptions}
                value={String(o.col)}
                onChange={(e) => o.setCol(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="qzk-field-lbl">Method</label>
              <Select
                aria-label="Method"
                options={OUTLIER_METHODS}
                value={o.method}
                onChange={(e) => o.setMethod(e.target.value as typeof o.method)}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end" }}>
            {o.method !== "mad" && (
              <div>
                <label className="qzk-field-lbl">alpha</label>
                <NumberField
                  aria-label="alpha"
                  value={String(o.alpha)}
                  width={64}
                  onChange={(v) => o.setAlpha(Number(v) || 0.05)}
                />
              </div>
            )}
            {o.method === "rosner" && (
              <div>
                <label className="qzk-field-lbl">k (max outliers)</label>
                <NumberField
                  aria-label="k (max outliers)"
                  value={String(o.k)}
                  width={64}
                  onChange={(v) => o.setK(Math.max(1, Math.round(Number(v)) || 1))}
                />
              </div>
            )}
            {o.method === "mad" && (
              <div>
                <label className="qzk-field-lbl">threshold</label>
                <NumberField
                  aria-label="threshold"
                  value={String(o.threshold)}
                  width={64}
                  onChange={(v) => o.setThreshold(Number(v) || 3.5)}
                />
              </div>
            )}
          </div>

          {o.busy && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              screening…
            </div>
          )}
          {o.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--warn, var(--text-faint))" }}>
              {o.error}
            </div>
          )}

          {!o.busy && !o.error && o.result && (
            <>
              <div style={{ marginTop: 12 }}>
                <ResultSummary result={o.result} />
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="qzk-field-lbl">
                  Flagged rows ({o.flaggedRowValues.length})
                </div>
                {o.flaggedRowValues.length === 0 ? (
                  <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                    none flagged
                  </div>
                ) : (
                  <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11 }}>
                    <thead style={{ color: "var(--text-faint)", textAlign: "right" }}>
                      <tr>
                        <th style={{ textAlign: "left" }}>row</th>
                        <th>value</th>
                      </tr>
                    </thead>
                    <tbody style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {o.flaggedRowValues.map((p) => (
                        <tr key={p.rowIndex}>
                          <td style={{ textAlign: "left" }}>{p.rowIndex}</td>
                          <td>{fmt(p.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <Button
                  size="sm"
                  disabled={o.flaggedRowIndices.length === 0}
                  onClick={o.selectFlaggedRows}
                  title="Highlight the flagged rows in the worksheet + plot (does NOT exclude or delete them)"
                >
                  Select flagged rows
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </ToolWindow>
  );
}

function ResultSummary({ result }: { result: NonNullable<ReturnType<typeof useOutlierScreening>["result"]> }) {
  if (result.method === "grubbs") {
    const r = result.data;
    return (
      <div className="qzk-ds-meta">
        G = {fmt(r.G)}, G_critical = {fmt(r.G_critical)} — {r.flagged ? "flagged" : "no outlier"} (N={r.N})
      </div>
    );
  }
  if (result.method === "dixon-q") {
    const r = result.data;
    return (
      <div className="qzk-ds-meta">
        Q = {fmt(r.Q)}, Q_critical = {fmt(r.Q_critical)} ({r.ratio}, {r.tail} tail) —{" "}
        {r.flagged ? "flagged" : "no outlier"} (N={r.N})
      </div>
    );
  }
  if (result.method === "rosner") {
    const r = result.data;
    return (
      <div className="qzk-ds-meta">
        {r.num_outliers} of up to {r.k} tested exceed their critical lambda (N={r.N})
      </div>
    );
  }
  const r = result.data;
  return (
    <div className="qzk-ds-meta">
      median = {fmt(r.median)}, MAD = {fmt(r.mad)} ({r.scale_method}), threshold = {fmt(r.threshold)} — N={r.N}
    </div>
  );
}
