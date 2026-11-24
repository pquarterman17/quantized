// Fit Model diagnostic plots (JMP's Actual by Predicted and Residual by
// Predicted plots): a modest SVG scatter, the fityx/BivariateView convention
// (Graph Builder is the publication-plot path). The reference line is y = x
// for actual-by-predicted and y = 0 for residual-by-predicted.

import { maxOf, minOf } from "../../../lib/arrayExtent";
import { fmtNum } from "../../../lib/format";

const W = 300;
const H = 170;
const PAD = 24;

interface Props {
  kind: "actual" | "residual";
  predicted: readonly (number | null)[];
  residual: readonly (number | null)[];
  responseLabel: string;
}

export default function FitModelPlot({ kind, predicted, residual, responseLabel }: Props) {
  const pts: [number, number][] = [];
  predicted.forEach((p, i) => {
    const r = residual[i];
    if (p === null || r === null || r === undefined) return;
    pts.push([p, kind === "actual" ? p + r : r]);
  });
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const lo = kind === "actual" ? Math.min(minOf(xs), minOf(ys)) : minOf(xs);
  const hi = kind === "actual" ? Math.max(maxOf(xs), maxOf(ys)) : maxOf(xs);
  const yLo = kind === "actual" ? lo : Math.min(minOf(ys), 0);
  const yHi = kind === "actual" ? hi : Math.max(maxOf(ys), 0);
  const sx = (v: number) => (hi > lo ? PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD) : W / 2);
  const sy = (v: number) => (yHi > yLo ? H - PAD - ((v - yLo) / (yHi - yLo)) * (H - 2 * PAD) : H / 2);
  const title = kind === "actual" ? `${responseLabel} actual by predicted` : `${responseLabel} residual by predicted`;
  const ref = kind === "actual"
    ? { x1: sx(lo), y1: sy(lo), x2: sx(hi), y2: sy(hi) }
    : { x1: sx(lo), y1: sy(0), x2: sx(hi), y2: sy(0) };
  const label = { fontSize: 10, fill: "var(--text-faint)", fontFamily: "var(--font-mono)" };
  return (
    <figure style={{ margin: 0 }}>
      <svg role="img" aria-label={title} width={W} height={H} style={{ background: "var(--surface-3)" }}>
        <line {...ref} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
        {pts.map(([x, y], i) => <circle key={i} cx={sx(x)} cy={sy(y)} r={2.2} fill="var(--text-faint)" />)}
        <text x={PAD} y={H - 6} {...label}>{fmtNum(lo)}</text>
        <text x={W - PAD} y={H - 6} textAnchor="end" {...label}>{fmtNum(hi)}</text>
        <text x={4} y={PAD - 8} {...label}>{fmtNum(yHi)}</text>
        <text x={4} y={H - PAD + 12} {...label}>{fmtNum(yLo)}</text>
      </svg>
      <figcaption className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {kind === "actual" ? "Actual vs predicted; dashed line y = x." : "Residual vs predicted; dashed line at 0."}
      </figcaption>
    </figure>
  );
}
