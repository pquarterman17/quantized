// Distribution platform (#52) — view. A draggable ToolWindow: pick a column and
// see its histogram, a box/quantile strip, descriptive stats, an optional
// distribution-fit overlay, and a Shapiro-Wilk normality verdict in one
// linked panel. Bars are DOM (not canvas) so the whole panel is testable.
// Thin — composition + fetching + brush math live in useDistribution;
// HistogramStrip/BoxStrip are the presentational sub-components.

import { fmtNum } from "../../../lib/format";
import { DIST_FAMILIES } from "../../../lib/distpdf";
import ToolWindow from "../../overlays/ToolWindow";
import { Select, StatusDot } from "../../primitives";
import { useApp } from "../../../store/useApp";
import BoxStrip from "./BoxStrip";
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

  return (
    <ToolWindow title="Distribution" width={380} onClose={() => setOpen(false)}>
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

          {d.error ? (
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
            </>
          )}
        </>
      )}
    </ToolWindow>
  );
}
