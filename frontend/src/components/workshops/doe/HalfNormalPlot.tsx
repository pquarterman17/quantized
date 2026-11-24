// Half-normal plot of the effects (Daniel 1959): |effect| against the
// half-normal quantile of its rank. Effects off the line through the small
// ones are active. A modest SVG scatter, the FitModelPlots convention.

import { maxOf } from "../../../lib/arrayExtent";
import { fmtNum } from "../../../lib/format";
import { plainTerm } from "../../../lib/doe";
import type { DoeEffectRow } from "../../../lib/api/doe";

const W = 320;
const H = 190;
const PAD = 28;

export default function HalfNormalPlot({ rows }: { rows: readonly DoeEffectRow[] }) {
  if (rows.length < 2) return null;
  const xMax = maxOf(rows.map((r) => r.half_normal_q)) || 1;
  const yMax = maxOf(rows.map((r) => r.abs_effect)) || 1;
  const sx = (v: number) => PAD + (v / xMax) * (W - 2 * PAD);
  const sy = (v: number) => H - PAD - (v / yMax) * (H - 2 * PAD);
  const label = { fontSize: 10, fill: "var(--text-faint)", fontFamily: "var(--font-mono)" };
  const big = [...rows].sort((a, b) => b.abs_effect - a.abs_effect).slice(0, 4);
  return (
    <figure style={{ margin: "8px 0 0" }}>
      <svg role="img" aria-label="Half-normal plot of effects" width={W} height={H} style={{ background: "var(--surface-3)" }}>
        <line x1={sx(0)} y1={sy(0)} x2={W - PAD} y2={PAD} stroke="var(--border-soft)" strokeDasharray="4 3" />
        {rows.map((r) => (
          <circle key={r.term} cx={sx(r.half_normal_q)} cy={sy(r.abs_effect)} r={3}
            fill={r.significant ? "var(--accent)" : "var(--text-faint)"}><title>{`${plainTerm(r.term)}: ${fmtNum(r.effect)}`}</title></circle>
        ))}
        {big.map((r) => (
          <text key={r.term} x={sx(r.half_normal_q) - 5} y={sy(r.abs_effect) + 3} textAnchor="end" {...label}>{plainTerm(r.term)}</text>
        ))}
        <text x={PAD} y={H - 8} {...label}>0</text>
        <text x={W - PAD} y={H - 8} textAnchor="end" {...label}>{fmtNum(xMax)}</text>
        <text x={4} y={PAD - 8} {...label}>{fmtNum(yMax)}</text>
        <text x={W / 2} y={H - 8} textAnchor="middle" {...label}>half-normal quantile</text>
      </svg>
      <figcaption className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        |effect| vs half-normal quantile; points far above the small-effect line are active.
      </figcaption>
    </figure>
  );
}
