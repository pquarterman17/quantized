// Peak Analyzer step ④ — a compact preview of the model fit (audit P2.4
// slice 2): the fitted points, the total model, the background, each peak
// component standing on that background, and a residual strip. The main plot
// has one fit-curve slot (the model goes there, via useModelFit); the
// components and residuals have no slot, so they are drawn here. Coordinates
// are the fit's own (the baseline-corrected working trace). Inline SVG,
// colours from the design tokens only.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";

const W = 388;
const H = 120;
const RH = 34;
const PAD = 4;
const MAX_POINTS = 1500;

type Col = readonly (number | null)[];

function extent(cols: Col[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cols) for (const v of c) if (v !== null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi >= lo)) return [0, 1];
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}

function path(order: number[], x: Col, y: Col, sx: (v: number) => number, sy: (v: number) => number): string {
  let d = "";
  let pen = false;
  for (const i of order) {
    const xi = x[i];
    const yi = y[i];
    if (xi === null || yi === null) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${sx(xi).toFixed(1)},${sy(yi).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export default function ModelFitPreview({ r }: { r: PeakModelFitResponse }) {
  const c = r.curves;
  const n = c.x.length;
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  const order = [...Array(n).keys()]
    .filter((i) => i % stride === 0 || i === n - 1)
    .sort((a, b) => (c.x[a] ?? 0) - (c.x[b] ?? 0));
  const stacked = c.components.map((comp) => comp.map((v, i) => (v === null || c.background[i] === null ? null : v + c.background[i]!)));
  const [x0, x1] = extent([c.x]);
  const [y0, y1] = extent([c.y, c.model, c.background, ...stacked]);
  const [r0, r1] = extent([c.residual]);
  const rMax = Math.max(Math.abs(r0), Math.abs(r1)) || 1;
  const sx = (v: number) => PAD + ((v - x0) / (x1 - x0)) * (W - 2 * PAD);
  const sy = (v: number) => H - PAD - ((v - y0) / (y1 - y0)) * (H - 2 * PAD);
  const sr = (v: number) => RH / 2 - (v / rMax) * (RH / 2 - 2);
  return (
    <svg
      role="img"
      aria-label="model fit preview: data, model, background, components and residuals"
      viewBox={`0 0 ${W} ${H + RH + 4}`}
      style={{ width: "100%", marginTop: 8, background: "var(--surface-1)", borderRadius: 4 }}
    >
      {order.map((i) =>
        c.x[i] !== null && c.y[i] !== null ? (
          <circle key={i} cx={sx(c.x[i]!)} cy={sy(c.y[i]!)} r={1.2} fill="var(--text-faint)" />
        ) : null,
      )}
      <path d={path(order, c.x, c.background, sx, sy)} fill="none" stroke="var(--text-dim)" strokeDasharray="3 2" />
      {stacked.map((comp, k) => (
        <path
          key={k}
          data-component={k}
          d={path(order, c.x, comp, sx, sy)}
          fill="none"
          stroke={`var(--series-${(k % 8) + 1})`}
          strokeWidth={1}
        />
      ))}
      <path d={path(order, c.x, c.model, sx, sy)} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
      <g transform={`translate(0 ${H + 4})`} aria-label="residuals">
        <line x1={PAD} x2={W - PAD} y1={RH / 2} y2={RH / 2} stroke="var(--border)" />
        <path d={path(order, c.x, c.residual, sx, sr)} fill="none" stroke="var(--text-dim)" strokeWidth={1} />
      </g>
    </svg>
  );
}
