// Distribution platform (#52) — view. A draggable ToolWindow: pick a column and
// see its histogram, a box/quantile strip, descriptive stats, an optional
// distribution-fit overlay, a "Compare distributions" ranked table (JMP_GAP
// J12), a percentile readout for the selected fit, and a Shapiro-Wilk
// normality verdict in one linked panel. Bars are DOM (not canvas) so the
// whole panel is testable. Thin — composition + fetching + brush math live in
// useDistribution; the result reads as one result book (lane RB3,
// DistributionResultBook) over the presentational sub-components.

import { DIST_FAMILIES } from "../../../lib/distpdf";
import { fmtNum } from "../../../lib/format";
import ToolWindow from "../../overlays/ToolWindow";
import { Switch } from "../../primitives/Switch";
import { Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { distributionRows } from "../analysisselection/statsInputReviewRows";
import DistributionBatchSection from "./DistributionBatchSection";
import DistributionResultBook from "./DistributionResultBook";
import { type FitPick, useDistribution } from "./useDistribution";

const FIT_OPTIONS: { value: FitPick; label: string }[] = [
  { value: "none", label: "None" },
  ...DIST_FAMILIES.map((f) => ({ value: f, label: f })),
];

export default function DistributionPanel() {
  const setOpen = useApp((s) => s.setDistributionOpen);
  const d = useDistribution();
  const colOptions = d.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const byActive = d.byLevels.length > 0;

  return (
    <ToolWindow id="distribution" title="Distribution" width={380} dockable onClose={() => setOpen(false)}>
      {!d.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset to profile.
        </div>
      ) : (
        <>
          <StatsInputReview inputs={d.inputs} rows={distributionRows(d.inputs, { col: d.col, byCol: d.byCol, fit: d.fitDist })} />
          <label className="qzk-field-lbl">Column</label>
          <Select
            options={colOptions}
            value={String(d.col)}
            onChange={(e) => d.setCol(Number(e.target.value))}
          />

          {/* By-column partitioning (JMP_GAP_PLAN J7): run this analysis once
              per level of an optional categorical column, render-only —
              never writes the shared row selection. */}
          {d.byOptions.length > 0 && (
            <>
              <label className="qzk-field-lbl" style={{ marginTop: 12 }}>
                By (optional)
              </label>
              <Select
                aria-label="By (optional)"
                options={[{ value: "", label: "None" }, ...d.byOptions.map((c) => ({ value: String(c.index), label: c.label }))]}
                value={d.byCol == null ? "" : String(d.byCol)}
                onChange={(e) => d.setByCol(e.target.value === "" ? null : Number(e.target.value))}
              />
            </>
          )}

          {!byActive && (
            <>
              {/* Distribution-fit overlay (item 6b). */}
              <label className="qzk-field-lbl" style={{ marginTop: 12 }}>
                Distribution fit
              </label>
              <Select
                options={FIT_OPTIONS}
                value={d.fitDist}
                onChange={(e) => d.setFitDist(e.target.value as FitPick)}
              />
              {d.fitDist !== "none" && !d.error && (
                <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
                  {d.fitBusy ? "fitting…" : d.fitError ? d.fitError : d.skippedReason ? d.skippedReason : d.currentFit ? <>
                    {d.currentFit.dist}: AIC {fmtNum(d.currentFit.aic)}, KS p={fmtNum(d.currentFit.ks_p)}
                    {d.bestFit && d.bestFit.dist !== d.currentFit.dist && <> · AIC-best: {d.bestFit.dist} (p={fmtNum(d.bestFit.ks_p)})</>}
                  </> : "—"}
                </div>
              )}
              {/* Compare distributions (JMP_GAP J12 items 1-2). */}
              <div style={{ marginTop: 12 }}>
                <Switch
                  checked={d.compareOpen}
                  onChange={d.setCompareOpen}
                  label="Compare distributions"
                />
              </div>
            </>
          )}

          {!byActive && d.error ? (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
              {d.error}
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <DistributionResultBook d={d} />
            </div>
          )}

          <DistributionBatchSection column={d.columns.find((c) => c.index === d.col)?.label ?? null} />
        </>
      )}
    </ToolWindow>
  );
}
