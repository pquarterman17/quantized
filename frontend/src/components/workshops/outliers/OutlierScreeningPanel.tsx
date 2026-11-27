// Outlier Screening panel (JMP_GAP_PLAN J9 residual) — view. Pick a channel
// + method, read the statistic/critical value/flagged rows, then
// "Select flagged rows" to hand them to the shared #50 selection so the
// existing exclude/keep-only worksheet actions can act on them. NEVER
// auto-excludes — see useOutlierScreening's module doc. The result reads as
// one result book (lane RB3, OutlierResultBook).

import { useState } from "react";

import { lazyRegion } from "../../../lib/lazyRegion";
import ToolWindow from "../../overlays/ToolWindow";
import { NumberField } from "../../primitives/NumberField";
import { Select } from "../../primitives";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { outlierRows } from "../analysisselection/statsInputReviewRows";
import OutlierBatchSection from "./OutlierBatchSection";
import OutlierByLevel from "./OutlierByLevel";
import OutlierResultBook from "./OutlierResultBook";
import { OUTLIER_METHODS, useOutlierScreening } from "./useOutlierScreening";
import { defaultAlpha } from "../../../lib/locale";

// Named settings: the shared preset bar, lazy.
const OutlierPresetBar = lazyRegion(() => import("./OutlierPresetBar"), "Presets");

export default function OutlierScreeningPanel() {
  const setOpen = useOutlierScreeningStore((s) => s.setOpen);
  const o = useOutlierScreening();
  // Opened from a saved result (its request is waiting at mount): the result outranks a preset.
  const [fromResult] = useState(() => useOutlierScreeningStore.getState().request !== null);
  const colOptions = o.columns.map((c) => ({ value: String(c.index), label: c.label }));

  return (
    <ToolWindow id="outlier-screening" title="Outlier screening" width={420} onClose={() => setOpen(false)}>
      {!o.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset to screen.
        </div>
      ) : (
        <>
          <OutlierPresetBar o={o} fromResult={fromResult} />
          <StatsInputReview inputs={o.inputs} rows={outlierRows(o.inputs, o)} />
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
                  onChange={(v) => o.setAlpha(Number(v) || defaultAlpha())}
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
                <OutlierResultBook o={o} />
              </div>
              {o.saveResultDisabledReason && (
                <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
                  {o.saveResultDisabledReason}
                </div>
              )}
            </>
          )}

          <OutlierByLevel o={o} />
          <OutlierBatchSection o={o} />
        </>
      )}
    </ToolWindow>
  );
}
