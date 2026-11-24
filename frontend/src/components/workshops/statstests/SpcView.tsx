// Statistical tests workshop — the SPC picture (GAP_AUDIT_9 J14): one SVG
// control chart per panel (centre line, ±3σ limits, points beyond the limits or
// tripping a run rule in the danger colour) and, for capability, the histogram
// with the specification limits and the normal fits. Modest SVG like the
// variability chart; Graph Builder stays the publication-plot path.

import type { CapabilityResult, SpcPanel } from "../../../lib/api/statsTestsSpc";
import type { SpcDisplay } from "../../../lib/statsTestsResultsSpc";

const W = 460;
const PAD = { l: 44, r: 10, t: 10, b: 22 };
const H = 150;

function extent(xs: number[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

const tick = (v: number): string => String(Number(v.toPrecision(5)));

function Frame({ y0, y1, children, label }: { y0: number; y1: number; children: React.ReactNode; label: string }) {
  const sy = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" />
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--border-strong)" />
      {[y0 + (y1 - y0) * 0.06, (y0 + y1) / 2, y1 - (y1 - y0) * 0.06].map((v, i) => (
        <text key={i} x={PAD.l - 4} y={sy(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{tick(v)}</text>
      ))}
      {children}
    </svg>
  );
}

function ControlPanel({ panel }: { panel: SpcPanel }) {
  const n = panel.values.length;
  const [y0, y1] = extent([...panel.values, ...panel.ucl, ...panel.lcl, panel.center]);
  const sx = (i: number) => PAD.l + (n <= 1 ? 0.5 : i / (n - 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const path = (ys: number[]) => ys.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const flagged = new Set([...panel.beyond_limits, ...panel.flagged]);
  return (
    <figure style={{ margin: "0 0 8px" }}>
      <figcaption className="qzk-field-lbl">
        {panel.name} chart · centre {tick(panel.center)} · UCL {tick(panel.ucl[0])} · LCL {tick(panel.lcl[0])}
        {flagged.size > 0 && <span style={{ color: "var(--danger)" }}> · {flagged.size} signal{flagged.size > 1 ? "s" : ""}</span>}
      </figcaption>
      <Frame y0={y0} y1={y1} label={`${panel.name} control chart`}>
        <path d={path(panel.ucl)} fill="none" stroke="var(--danger)" strokeDasharray="4 3" />
        <path d={path(panel.lcl)} fill="none" stroke="var(--danger)" strokeDasharray="4 3" />
        <line x1={PAD.l} x2={W - PAD.r} y1={sy(panel.center)} y2={sy(panel.center)} stroke="var(--text-dim)" />
        <path d={path(panel.values)} fill="none" stroke="var(--accent)" strokeWidth={1.2} />
        {panel.values.map((v, i) => (
          <circle key={i} cx={sx(i)} cy={sy(v)} r={flagged.has(i) ? 3.8 : 2.4} data-flagged={flagged.has(i) || undefined}
            fill={flagged.has(i) ? "var(--danger)" : "var(--accent)"} />
        ))}
        <text x={PAD.l} y={H - 6} fontSize={9} fill="var(--text-faint)">1</text>
        <text x={W - PAD.r} y={H - 6} fontSize={9} textAnchor="end" fill="var(--text-faint)">{n}</text>
      </Frame>
      {panel.violations.filter((v) => v.indices.length > 0).map((v) => (
        <div key={v.rule} className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          {v.label}: point{v.indices.length > 1 ? "s" : ""} {v.indices.slice(0, 12).map((i) => i + 1).join(", ")}{v.indices.length > 12 ? ", …" : ""}
        </div>
      ))}
    </figure>
  );
}

const pdf = (x: number, mu: number, s: number): number => Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));

function CapabilityHistogram({ r }: { r: CapabilityResult }) {
  const { edges, counts } = r.histogram;
  const width = edges[1] - edges[0];
  const total = counts.reduce((a, b) => a + b, 0);
  const specs = [r.lsl, r.usl, r.target].filter((v): v is number => v != null);
  const [x0, x1] = extent([...edges, ...specs]);
  const dens = counts.map((c) => c / (total * width));
  const topCurve = Math.max(pdf(r.mean, r.mean, Math.min(r.within.sigma, r.overall.sigma)), ...dens);
  const y1 = topCurve * 1.08;
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => PAD.t + (1 - v / y1) * (H - PAD.t - PAD.b);
  const curve = (s: number) => Array.from({ length: 81 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / 80;
    return `${i === 0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(pdf(x, r.mean, s)).toFixed(1)}`;
  }).join(" ");
  const line = (v: number | null, label: string, color: string, dash?: string) => v == null ? null : (
    <g key={label}>
      <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} stroke={color} strokeDasharray={dash} strokeWidth={1.5} />
      <text x={sx(v)} y={PAD.t + 9} fontSize={9} textAnchor="middle" fill={color}>{label}</text>
    </g>
  );
  return (
    <figure style={{ margin: "0 0 8px" }}>
      <figcaption className="qzk-field-lbl">Histogram with specification limits and normal fits (solid: overall, dashed: within)</figcaption>
      <svg role="img" aria-label="Capability histogram" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--border-strong)" />
        {dens.map((d, i) => (
          <rect key={i} x={sx(edges[i])} y={sy(d)} width={Math.max(0, sx(edges[i + 1]) - sx(edges[i]) - 1)} height={H - PAD.b - sy(d)}
            fill="var(--accent-soft)" stroke="var(--accent)" />
        ))}
        <path d={curve(r.overall.sigma)} fill="none" stroke="var(--text)" />
        <path d={curve(r.within.sigma)} fill="none" stroke="var(--text-dim)" strokeDasharray="4 3" />
        {line(r.lsl, "LSL", "var(--danger)")}
        {line(r.usl, "USL", "var(--danger)")}
        {line(r.target, "T", "var(--warn)", "3 3")}
        {[x0 + (x1 - x0) * 0.06, (x0 + x1) / 2, x1 - (x1 - x0) * 0.06].map((v, i) => (
          <text key={i} x={sx(v)} y={H - 8} fontSize={9} textAnchor="middle" fill="var(--text-faint)">{tick(v)}</text>
        ))}
      </svg>
      {r.normality_p != null && r.normality_p < 0.05 && (
        <div className="qzk-ds-meta" style={{ color: "var(--warn)" }}>
          Shapiro-Wilk p = {tick(r.normality_p)}: the data look non-normal, so the normal-fit indices and ppm are unreliable.
        </div>
      )}
    </figure>
  );
}

export default function SpcView({ spc }: { spc: SpcDisplay }) {
  return spc.kind === "chart"
    ? <>{spc.result.panels.map((p) => <ControlPanel key={p.name} panel={p} />)}</>
    : <CapabilityHistogram r={spc.result} />;
}
