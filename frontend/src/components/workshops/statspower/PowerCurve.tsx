// Power against n at the solved effect: a small inline SVG, with the target power
// and the answer marked. Tokens only; the numbers are the backend's.

import type { PowerSolveResult } from "../../../lib/api/statsPower";

const W = 320;
const H = 150;
const PAD = { l: 34, r: 8, t: 8, b: 26 };
const faint = { fontSize: 9, fill: "var(--text-faint)", fontFamily: "var(--font-mono)" } as const;

export default function PowerCurve({ result }: { result: PowerSolveResult }) {
  const pts = result.curve.n.flatMap((n, i) => {
    const p = result.curve.power[i];
    return n != null && p != null ? [[n, p] as const] : [];
  });
  if (pts.length < 2) return null;
  const lo = pts[0]![0];
  const hi = pts[pts.length - 1]![0];
  const x = (n: number) => PAD.l + ((n - lo) / (hi - lo || 1)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - p) * (H - PAD.t - PAD.b);
  const line = pts.map(([n, p]) => `${x(n).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const target = result.target_power;
  return (
    <svg role="img" aria-label="Power curve" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, marginTop: 8 }}>
      <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="var(--border)" />
      {[0, 0.5, 1].map((p) => (
        <text key={p} x={PAD.l - 4} y={y(p) + 3} textAnchor="end" {...faint}>{p}</text>
      ))}
      {target != null && <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--text-faint)" strokeDasharray="3 3" />}
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      <circle cx={x(result.n)} cy={y(result.power)} r={3.5} fill="var(--accent)" />
      <text x={PAD.l} y={H - 8} {...faint}>{lo}</text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" {...faint}>{hi}</text>
      <text x={(W + PAD.l) / 2} y={H - 8} textAnchor="middle" {...faint}>n per group</text>
    </svg>
  );
}
