// Fit Model effect leverage plot (JMP Effect Leverage Plots; the partial
// regression / added-variable plot, calc/stats_lm_leverage.py). Points scatter
// about the fit line y = x; the dashed horizontal line y = 0 is the hypothesis
// that the effect is zero. SVG, like FitModelPlots (Graph Builder is the
// publication path).

import { maxOf, minOf } from "../../../lib/arrayExtent";
import { fmtNum } from "../../../lib/format";

const W = 300;
const H = 170;
const PAD = 24;

export default function FitModelLeverage({ effect, x, y, p }: { effect: string; x: readonly number[]; y: readonly number[]; p: number | null }) {
  if (!x.length) return null;
  const xLo = minOf(x);
  const xHi = maxOf(x);
  const yLo = Math.min(minOf(y), 0, xLo);
  const yHi = Math.max(maxOf(y), 0, xHi);
  const sx = (v: number) => (xHi > xLo ? PAD + ((v - xLo) / (xHi - xLo)) * (W - 2 * PAD) : W / 2);
  const sy = (v: number) => (yHi > yLo ? H - PAD - ((v - yLo) / (yHi - yLo)) * (H - 2 * PAD) : H / 2);
  const label = { fontSize: 10, fill: "var(--text-faint)", fontFamily: "var(--font-mono)" };
  const title = `${effect} leverage plot`;
  return (
    <figure style={{ margin: 0 }}>
      <svg role="img" aria-label={title} width={W} height={H} style={{ background: "var(--surface-3)" }}>
        <line x1={sx(xLo)} y1={sy(0)} x2={sx(xHi)} y2={sy(0)} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={sx(xLo)} y1={sy(xLo)} x2={sx(xHi)} y2={sy(xHi)} stroke="var(--accent)" strokeWidth={1.5} />
        {x.map((v, i) => <circle key={i} cx={sx(v)} cy={sy(y[i] ?? 0)} r={2.2} fill="var(--text-faint)" />)}
        <text x={PAD} y={H - 6} {...label}>{fmtNum(xLo)}</text>
        <text x={W - PAD} y={H - 6} textAnchor="end" {...label}>{fmtNum(xHi)}</text>
        <text x={4} y={PAD - 8} {...label}>{fmtNum(yHi)}</text>
        <text x={4} y={H - PAD - 3} {...label}>{fmtNum(yLo)}</text>
      </svg>
      <figcaption className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        Leverage plot for {effect} (Prob &gt; F {fmtNum(p)}). Solid line: the fitted effect. Dashed line: no effect.
        The tighter the points hug the solid line rather than the dashed one, the stronger the effect.
      </figcaption>
    </figure>
  );
}
