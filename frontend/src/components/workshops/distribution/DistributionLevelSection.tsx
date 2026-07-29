// Distribution platform (JMP_GAP_PLAN J7 "By" role) — one collapsible
// section per level of the chosen By column. Deliberately reuses the SAME
// histogram + descriptive-stats + normality rendering DistributionPanel's
// un-partitioned view uses, at a smaller scale (JMP_GAP_PLAN's own
// acceptance bar: "keep it simple"). No fit-distribution overlay/Compare/
// percentile here — those stay single-column-only. Never brushes the shared
// row selection (a no-op `onBrush`) — By is render-only partitioning.

import { useState } from "react";

import { fmtNum } from "../../../lib/format";
import { StatusDot } from "../../primitives";
import BoxStrip from "./BoxStrip";
import HistogramStrip from "./HistogramStrip";
import type { DistributionLevelResult } from "./useDistribution";

const STAT_FIELDS: { key: string; label: string }[] = [
  { key: "N", label: "N" },
  { key: "mean", label: "mean" },
  { key: "median", label: "median" },
  { key: "std", label: "std" },
  { key: "min", label: "min" },
  { key: "max", label: "max" },
];

const noopBrush = () => undefined;

export default function DistributionLevelSection({ result }: { result: DistributionLevelResult }) {
  const [open, setOpen] = useState(true);
  const isNormal = result.norm ? result.norm.p >= 0.05 : null;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text)",
          font: "inherit",
        }}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <strong>{result.label}</strong>
        <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          n={result.n}
        </span>
      </button>

      {open && (
        <>
          {result.error ? (
            <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
              {result.error}
            </div>
          ) : (
            <>
              {result.hist && (
                <HistogramStrip hist={result.hist} fitCurve={null} brushedBins={null} onBrush={noopBrush} />
              )}

              {result.desc && (
                <BoxStrip
                  min={Number(result.desc.min)}
                  q1={Number(result.desc.q1)}
                  median={Number(result.desc.median)}
                  q3={Number(result.desc.q3)}
                  max={Number(result.desc.max)}
                />
              )}

              <div
                className="qzk-ds-meta"
                style={{
                  marginTop: 8,
                  display: "grid",
                  gridTemplateColumns: "auto auto auto auto",
                  gap: "4px 12px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {STAT_FIELDS.map((f) => (
                  <span key={f.key}>
                    <span style={{ color: "var(--text-faint)" }}>{f.label} </span>
                    {fmtNum(result.desc?.[f.key])}
                  </span>
                ))}
              </div>

              <div style={{ marginTop: 8 }}>
                {result.norm ? (
                  <StatusDot
                    tone={isNormal ? "ok" : "warn"}
                    label={
                      <span>
                        {isNormal ? "Consistent with normal" : "Not normal"} · W={fmtNum(result.norm.W)}, p=
                        {fmtNum(result.norm.p)}
                      </span>
                    }
                  />
                ) : (
                  <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
                    Normality: {result.normNote ?? "—"}
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
