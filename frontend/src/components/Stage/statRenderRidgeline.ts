// The Stat Stage's ridgeline canvas (plan item 20): one filled Gaussian-KDE
// curve per group, stacked, the first group on top. Every vertex comes from
// `lib/statRidgeline.ridgelineGeometry`, which `calc/statplots_ridgeline.py`
// mirrors for the matplotlib export (`calc/figure_dist2.py`) and the wire
// fixture `tests/fixtures/wire/stat_ridgeline.json` pins; this file only maps
// data coordinates to pixels. The curves are the violin's KDE (the same
// bandwidth rules), so a ridge is a violin's half-outline.

import { RIDGE_FILL_ALPHA, ridgelineGeometry, type RidgeBw, type RidgelineWire } from "../../lib/statRidgeline";
import { seriesColor } from "../../lib/uplotOpts";
import { drawNumericXAxis, type Rect } from "./statRender";

export interface RidgelineDraw {
  mode: "ridgeline";
  wire: RidgelineWire;
  /** The group names (top row first) and the finite values behind each ridge
   *  (what the export re-sends). */
  labels: string[];
  groups: number[][];
  /** The tallest peak in row spacings, and the bandwidth the curves were made with. */
  overlap: number;
  bw: RidgeBw;
  /** Every ridge scaled to its own peak (else one shared scale). */
  each?: boolean;
  /** Facet grids: the tallest density over every panel (one shared scale), else this panel's own. */
  sharedMax?: number;
  valueLabel: string;
}

export function drawRidgeline(ctx: CanvasRenderingContext2D, rect: Rect, d: RidgelineDraw, ink: string, muted: string) {
  const geo = ridgelineGeometry(d.wire, d.overlap, d.each, d.sharedMax);
  const [x0, x1] = geo.domain;
  const [y0, y1] = geo.y_domain;
  const sx = (v: number) => rect.x + ((v - x0) / (x1 - x0)) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - y0) / (y1 - y0)) * rect.h;
  drawNumericXAxis(ctx, rect, geo.domain, d.valueLabel, ink, muted);

  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  geo.baselines.forEach((b, k) => ctx.fillText(d.labels[k] ?? `group ${k + 1}`, rect.x - 7, sy(b)));

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const path = (pts: readonly [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
  };
  geo.ridges.forEach((ridge, k) => {
    const color = seriesColor(k);
    path(ridge.fill);
    ctx.closePath();
    ctx.globalAlpha = RIDGE_FILL_ALPHA;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    path(ridge.line);
    ctx.stroke();
  });
  ctx.restore();
}
