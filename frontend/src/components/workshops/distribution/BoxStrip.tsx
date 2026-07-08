// Distribution platform (#52 item 6a) — a compact box/quantile strip under
// the histogram: min/q1/median/q3/max from the SAME /api/stats/descriptive
// response the panel already fetches (no new network call). Positioned as a
// percentage of [min, max] so it lines up with the histogram bars above it
// (both are computed off nearly the same domain — numpy.histogram's default
// range is (data.min(), data.max())).

import { fmtNum } from "../../../lib/format";
import { pctPosition } from "../../../lib/distribution";

export interface BoxStripProps {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export default function BoxStrip({ min, q1, median, q3, max }: BoxStripProps) {
  if (![min, q1, median, q3, max].every(Number.isFinite)) return null;
  const pct = (v: number) => pctPosition(v, min, max);
  const boxLeft = pct(q1);
  const boxWidth = Math.max(pct(q3) - pct(q1), 0.5);

  return (
    <div
      aria-label="box-quantile strip"
      style={{ position: "relative", height: 18, marginTop: 10 }}
    >
      <div
        title={`range ${fmtNum(min)} – ${fmtNum(max)}`}
        style={{
          position: "absolute",
          top: 9,
          left: `${pct(min)}%`,
          width: `${Math.max(pct(max) - pct(min), 0.5)}%`,
          height: 1,
          background: "var(--border)",
        }}
      />
      <div
        title={`Q1 ${fmtNum(q1)} – Q3 ${fmtNum(q3)} (IQR)`}
        style={{
          position: "absolute",
          top: 2,
          left: `${boxLeft}%`,
          width: `${boxWidth}%`,
          height: 14,
          background: "var(--accent-soft, var(--surface-3))",
          border: "1px solid var(--accent)",
          boxSizing: "border-box",
        }}
      />
      <div
        title={`median ${fmtNum(median)}`}
        style={{
          position: "absolute",
          top: 0,
          left: `${pct(median)}%`,
          width: 2,
          height: 18,
          background: "var(--accent)",
        }}
      />
      <div
        title={`min ${fmtNum(min)}`}
        style={{ position: "absolute", top: 4, left: `${pct(min)}%`, width: 1, height: 10, background: "var(--text-faint)" }}
      />
      <div
        title={`max ${fmtNum(max)}`}
        style={{ position: "absolute", top: 4, left: `${pct(max)}%`, width: 1, height: 10, background: "var(--text-faint)" }}
      />
    </div>
  );
}
