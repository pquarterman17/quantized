// Distribution platform (#52) — view. A draggable ToolWindow: pick a column and
// see its histogram, a box/quantile strip, descriptive stats, an optional
// distribution-fit overlay, a "Compare distributions" ranked table (JMP_GAP
// J12), a percentile readout for the selected fit, and a Shapiro-Wilk
// normality verdict in one linked panel. Bars are DOM (not canvas) so the
// whole panel is testable. Thin — composition + fetching + brush math live in
// useDistribution; HistogramStrip/BoxStrip/CompareDistributionsTable are the
// presentational sub-components.

import { fmtNum } from "../../../lib/format";
import { DIST_FAMILIES, type DistFamily } from "../../../lib/distpdf";
import ToolWindow from "../../overlays/ToolWindow";
import { NumberField } from "../../primitives/NumberField";
import { Switch } from "../../primitives/Switch";
import { Button, Select, StatusDot } from "../../primitives";
import { useApp } from "../../../store/useApp";
import BoxStrip from "./BoxStrip";
import CompareDistributionsTable from "./CompareDistributionsTable";
import DistributionLevelSection from "./DistributionLevelSection";
import HistogramStrip from "./HistogramStrip";
import { type FitPick, useDistribution } from "./useDistribution";

const STAT_FIELDS: { key: string; label: string }[] = [
  { key: "N", label: "N" },
  { key: "mean", label: "mean" },
  { key: "median", label: "median" },
  { key: "std", label: "std" },
  { key: "min", label: "min" },
  { key: "max", label: "max" },
];

const FIT_OPTIONS: { value: FitPick; label: string }[] = [
  { value: "none", label: "None" },
  ...DIST_FAMILIES.map((f) => ({ value: f, label: f })),
];

export default function DistributionPanel() {
  const setOpen = useApp((s) => s.setDistributionOpen);
  const d = useDistribution();
  const colOptions = d.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const isNormal = d.norm ? d.norm.p >= 0.05 : null;
  const byActive = d.byLevels.length > 0;

  return (
    <ToolWindow id="distribution" title="Distribution" width={380} onClose={() => setOpen(false)}>
      {!d.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to profile.
        </div>
      ) : (
        <>
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

          {byActive ? (
            <>
              {d.byTotalLevels > d.byLevels.length && (
                <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
                  By column has {d.byTotalLevels} levels — showing the first {d.byLevels.length}
                </div>
              )}
              {d.byBusy && d.byResults.length === 0 ? (
                <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
                  analyzing {d.byLevels.length} levels…
                </div>
              ) : (
                d.byResults.map((r) => <DistributionLevelSection key={r.label} result={r} />)
              )}
            </>
          ) : d.error ? (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
              {d.error}
            </div>
          ) : (
            <>
              {d.hist && (
                <HistogramStrip
                  hist={d.hist}
                  fitCurve={d.fitCurve}
                  brushedBins={d.brushedBins}
                  onBrush={d.brushBins}
                />
              )}

              {d.desc && (
                <BoxStrip
                  min={Number(d.desc.min)}
                  q1={Number(d.desc.q1)}
                  median={Number(d.desc.median)}
                  q3={Number(d.desc.q3)}
                  max={Number(d.desc.max)}
                />
              )}

              {/* Descriptive stats. */}
              <div
                className="qzk-ds-meta"
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "auto auto auto auto",
                  gap: "4px 12px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {STAT_FIELDS.map((f) => (
                  <span key={f.key}>
                    <span style={{ color: "var(--text-faint)" }}>{f.label} </span>
                    {fmtNum(d.desc?.[f.key])}
                  </span>
                ))}
              </div>

              {/* Normality verdict. */}
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                {d.norm ? (
                  <StatusDot
                    tone={isNormal ? "ok" : "warn"}
                    label={
                      <span>
                        {isNormal ? "Consistent with normal" : "Not normal"} · Shapiro–Wilk W=
                        {fmtNum(d.norm.W)}, p={fmtNum(d.norm.p)}
                      </span>
                    }
                  />
                ) : (
                  <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                    Normality: {d.normNote ?? "—"}
                  </span>
                )}
              </div>

              {/* Distribution-fit overlay (item 6b). */}
              <label className="qzk-field-lbl" style={{ marginTop: 12 }}>
                Distribution fit
              </label>
              <Select
                options={FIT_OPTIONS}
                value={d.fitDist}
                onChange={(e) => d.setFitDist(e.target.value as FitPick)}
              />
              {d.fitDist !== "none" && (
                <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
                  {d.fitBusy ? (
                    "fitting…"
                  ) : d.fitError ? (
                    d.fitError
                  ) : d.skippedReason ? (
                    d.skippedReason
                  ) : d.currentFit ? (
                    <>
                      {d.currentFit.dist}: AIC {fmtNum(d.currentFit.aic)}, KS p={fmtNum(d.currentFit.ks_p)}
                      {d.bestFit && d.bestFit.dist !== d.currentFit.dist && (
                        <> · AIC-best: {d.bestFit.dist} (p={fmtNum(d.bestFit.ks_p)})</>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
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
              {d.compareOpen && (
                <>
                  {d.fitBusy && d.rankedFits.length === 0 ? (
                    <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
                      fitting all families…
                    </div>
                  ) : d.fitError ? (
                    <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
                      {d.fitError}
                    </div>
                  ) : (
                    <CompareDistributionsTable
                      rankedFits={d.rankedFits}
                      rankingMetric={d.rankingMetric}
                      winnerDist={d.winnerDist}
                      selected={d.fitDist}
                      onSelect={(dist: DistFamily) => d.setFitDist(dist)}
                      skipped={d.fits?.skipped ?? []}
                    />
                  )}
                </>
              )}

              {/* Percentile / quantile readout (JMP_GAP J12 item 4) — for
                  whichever family is currently selected/overlaid. */}
              {d.currentFit && (
                <div style={{ marginTop: 12 }}>
                  <label className="qzk-field-lbl">
                    Percentiles ({d.currentFit.dist} fit)
                  </label>
                  {d.quantiles &&
                  (d.quantiles.q1 == null || d.quantiles.median == null || d.quantiles.q3 == null) ? (
                    <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                      {d.currentFit.dist} has no closed-form quantile function — residual (needs a
                      numeric inverse-incomplete-gamma).
                    </div>
                  ) : (
                    d.quantiles && (
                      <div
                        className="qzk-ds-meta"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto auto auto",
                          gap: "4px 12px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        <span>
                          <span style={{ color: "var(--text-faint)" }}>q1 </span>
                          {fmtNum(d.quantiles.q1)}
                        </span>
                        <span>
                          <span style={{ color: "var(--text-faint)" }}>median </span>
                          {fmtNum(d.quantiles.median)}
                        </span>
                        <span>
                          <span style={{ color: "var(--text-faint)" }}>q3 </span>
                          {fmtNum(d.quantiles.q3)}
                        </span>
                      </div>
                    )
                  )}
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                    <NumberField
                      value={d.percentileInput}
                      onChange={(v) => d.setPercentileInput(Number(v))}
                      unit="%ile"
                      width={56}
                    />
                    <span className="qzk-ds-meta">
                      {d.percentileValue == null ? "—" : fmtNum(d.percentileValue)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {(byActive ? d.byResults.length > 0 : !!d.desc) && (
            <div style={{ marginTop: 12 }}>
              <Button size="sm" disabled={d.reportBusy} onClick={() => void d.toReport()}>
                {d.reportBusy ? "Reporting…" : "→ Report"}
              </Button>
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
