// Statistical tests workshop — the life-data pictures (GAP_AUDIT_9 G8): the
// probability plot (axes linearised for the chosen distribution: the fitted line
// is straight, the Wald band is dashed) and the Kaplan-Meier curve with its
// Greenwood band. Modest SVG like SpcView; Graph Builder stays the
// publication-plot path.

import { useId } from "react";

import type { LifeDistributionResult, LifePlot } from "../../../lib/api/statsTestsLife";

const W = 460;
const H = 230;
const HK = 170;
const PAD = { l: 52, r: 12, t: 10, b: 30 };

const tick = (v: number): string => String(Number(v.toPrecision(3)));
const pctLabel = (p: number): string => `${Number((p * 100).toPrecision(3))}%`;

/** 1-2-5 ticks inside [lo, hi] on a log axis. */
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

/** Round-number ticks (1-2-5 steps) inside [lo, hi] on a linear axis. */
function linTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 5 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function ProbabilityPlot({ plot, name }: { plot: LifePlot; name: string }) {
  const gx = (t: number) => (plot.x_log ? Math.log(t) : t);
  const xs = plot.line.map((l) => gx(l.t));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  // The y range follows the data points; the line and band are clipped to the frame.
  const zlo = Math.min(...plot.points.map((q) => q.z)) - 0.8;
  const zhi = Math.max(...plot.points.map((q) => q.z)) + 0.8;
  const clip = useId();
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const sy = (z: number) => PAD.t + (1 - (z - zlo) / (zhi - zlo)) * (H - PAD.t - PAD.b);
  const path = (key: "z" | "z_low" | "z_high") =>
    plot.line.map((l, i) => `${i === 0 ? "M" : "L"}${sx(gx(l.t)).toFixed(1)},${sy(l[key]).toFixed(1)}`).join(" ");
  const tmin = plot.line[0].t, tmax = plot.line[plot.line.length - 1].t;
  const xTicks = plot.x_log ? logTicks(tmin, tmax) : linTicks(tmin, tmax);
  const yTicks = plot.ticks.filter((k) => k.z > zlo && k.z < zhi);
  return (
    <figure style={{ margin: "0 0 8px" }}>
      <figcaption className="qzk-field-lbl">{name} probability plot · {plot.method === "kaplan-meier" ? "Kaplan-Meier midpoints" : "median ranks"} · dashed: Wald band</figcaption>
      <svg role="img" aria-label={`${name} probability plot`} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--border-strong)" />
        {yTicks.map((k) => (
          <g key={k.p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(k.z)} y2={sy(k.z)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={PAD.l - 4} y={sy(k.z) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{pctLabel(k.p)}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={sx(gx(v))} y={H - PAD.b + 12} textAnchor="middle" fontSize={9} fill="var(--text-faint)">{tick(v)}</text>
        ))}
        <clipPath id={clip}><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} /></clipPath>
        <g clipPath={`url(#${clip})`}>
          <path d={path("z_low")} fill="none" stroke="var(--accent)" strokeDasharray="4 3" />
          <path d={path("z_high")} fill="none" stroke="var(--accent)" strokeDasharray="4 3" />
          <path d={path("z")} fill="none" stroke="var(--accent)" strokeWidth={1.4} />
        </g>
        {plot.points.map((q, i) => <circle key={i} cx={sx(gx(q.t))} cy={sy(q.z)} r={2.8} fill="var(--text)" data-point />)}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--text-faint)">time{plot.x_log ? " (log scale)" : ""}</text>
      </svg>
    </figure>
  );
}

function KaplanMeierPlot({ km }: { km: LifeDistributionResult["kaplan_meier"] }) {
  const tmax = km.times[km.times.length - 1] * 1.05 || 1;
  const sx = (t: number) => PAD.l + (t / tmax) * (W - PAD.l - PAD.r);
  const sy = (s: number) => PAD.t + (1 - s) * (HK - PAD.t - PAD.b);
  const step = (vals: (number | null)[]) => {
    let d = `M${sx(0)},${sy(1)}`;
    let prev = 1;
    km.times.forEach((t, i) => {
      const v = vals[i] ?? prev;
      d += ` L${sx(t).toFixed(1)},${sy(prev).toFixed(1)} L${sx(t).toFixed(1)},${sy(v).toFixed(1)}`;
      prev = v;
    });
    return d;
  };
  return (
    <figure style={{ margin: "0 0 8px" }}>
      <figcaption className="qzk-field-lbl">Kaplan-Meier survival · dashed: pointwise exponential-Greenwood band</figcaption>
      <svg role="img" aria-label="Kaplan-Meier survival curve" viewBox={`0 0 ${W} ${HK}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={sy(0)} stroke="var(--border-strong)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} stroke="var(--border-strong)" />
        {[0, 0.5, 1].map((s) => <text key={s} x={PAD.l - 4} y={sy(s) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{s}</text>)}
        {linTicks(0, tmax).map((t) => <text key={t} x={sx(t)} y={sy(0) + 12} textAnchor="middle" fontSize={9} fill="var(--text-faint)">{tick(t)}</text>)}
        <path d={step(km.ci_low)} fill="none" stroke="var(--text-dim)" strokeDasharray="4 3" />
        <path d={step(km.ci_high)} fill="none" stroke="var(--text-dim)" strokeDasharray="4 3" />
        <path d={step(km.survival)} fill="none" stroke="var(--accent)" strokeWidth={1.4} />
      </svg>
    </figure>
  );
}

export default function LifeView({ result }: { result: LifeDistributionResult }) {
  const name = result.distribution === "sev" ? "Smallest extreme value" : result.distribution[0].toUpperCase() + result.distribution.slice(1);
  return (
    <>
      <ProbabilityPlot plot={result.plot} name={name} />
      <KaplanMeierPlot km={result.kaplan_meier} />
    </>
  );
}
