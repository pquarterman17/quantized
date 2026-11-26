// The Stat Stage's half / split violin, paired before-after and lollipop
// canvases (plan item 20). Every vertex comes from `lib/statDist3`, which
// `calc/statplots_{sideviolin,paired,lollipop}.py` mirrors for the matplotlib
// export (`calc/figure_dist3.py`) and the wire fixtures pin; this file only maps
// data coordinates to pixels. Lazy only (the Stat Stage).

import type { RidgelineWire } from "../../lib/statRidgeline";
import {
  lollipopGeometry,
  pairedGeometry,
  sideViolinGeometry,
  type LollipopSeries,
  type PairedSeries,
  type Pt,
  type Side,
  type SideViolinStyle,
} from "../../lib/statDist3";
import { seriesColor } from "../../lib/uplotOpts";
import { drawValueAxis, type Rect } from "./statRender";

export const SIDE_FILL_ALPHA = 0.7;
const LINE_ALPHA = 0.5;

export interface SideViolinDraw {
  mode: "sideviolin";
  wire: RidgelineWire;
  style: SideViolinStyle;
  /** Per group (index-aligned with `wire.groups` and `groups`): its axis position and side. */
  positions: number[];
  sides: Side[];
  slotLabels: string[];
  /** The left and right level of a split (its legend). */
  levels: string[];
  groups: number[][];
  /** The group names (`wire.groups` order), what the export labels the request with. */
  labels: string[];
  bw: "scott" | "silverman" | number;
  valueLabel: string;
}
export interface PairedDraw {
  mode: "paired";
  series: PairedSeries;
  ci: boolean;
  labels: [string, string];
  valueLabel: string;
}
export interface LollipopDraw {
  mode: "lollipop";
  series: LollipopSeries;
  groups: number[][];
  labels: string[];
  valueLabel: string;
}

/** Data -> pixel maps for a rect and the two domains. */
function mapper(rect: Rect, xd: [number, number], yd: [number, number]) {
  return {
    sx: (v: number) => rect.x + ((v - xd[0]) / (xd[1] - xd[0])) * rect.w,
    sy: (v: number) => rect.y + rect.h - ((v - yd[0]) / (yd[1] - yd[0])) * rect.h,
  };
}

/** Tick marks and names at integer positions 0..n-1 under the plot. */
function drawPositions(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  sx: (v: number) => number,
  labels: readonly string[],
  ink: string,
  muted: string,
) {
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  ctx.strokeStyle = muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const room = Math.max(3, Math.floor(rect.w / Math.max(1, labels.length) / 6));
  labels.forEach((s, k) => {
    const x = sx(k);
    ctx.beginPath();
    ctx.moveTo(x, rect.y + rect.h);
    ctx.lineTo(x, rect.y + rect.h + 4);
    ctx.stroke();
    ctx.fillText(s.length > room ? `${s.slice(0, room - 1)}…` : s, x, rect.y + rect.h + 6);
  });
  ctx.fillStyle = ink;
}

function clipTo(ctx: CanvasRenderingContext2D, rect: Rect) {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
}

function trace(ctx: CanvasRenderingContext2D, pts: readonly Pt[], sx: (v: number) => number, sy: (v: number) => number) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
}

export function drawSideViolin(ctx: CanvasRenderingContext2D, rect: Rect, d: SideViolinDraw, ink: string, muted: string) {
  const geo = sideViolinGeometry(d.wire, d.positions, d.sides, d.style);
  const { sx, sy } = mapper(rect, geo.x_domain, geo.y_domain);
  drawValueAxis(ctx, rect, geo.y_domain, d.valueLabel, ink, muted);
  const names = d.slotLabels.length === geo.slots ? d.slotLabels : Array.from({ length: geo.slots }, (_, i) => String(i + 1));
  drawPositions(ctx, rect, sx, names, ink, muted);
  ctx.save();
  clipTo(ctx, rect);
  for (const v of geo.violins) {
    const color = seriesColor(v.color);
    trace(ctx, v.fill, sx, sy);
    ctx.closePath();
    ctx.globalAlpha = SIDE_FILL_ALPHA;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    trace(ctx, v.line, sx, sy);
    ctx.stroke();
  }
  ctx.restore();
  if (d.style === "split" && d.levels.length) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    d.levels.forEach((name, k) => {
      const y = rect.y + 10 + k * 16;
      ctx.globalAlpha = SIDE_FILL_ALPHA;
      ctx.fillStyle = seriesColor(k);
      ctx.fillRect(rect.x + rect.w - 120, y - 5, 10, 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.fillText(name, rect.x + rect.w - 104, y);
    });
  }
}

export function drawPaired(ctx: CanvasRenderingContext2D, rect: Rect, d: PairedDraw, ink: string, muted: string) {
  const geo = pairedGeometry(d.series, d.ci);
  const { sx, sy } = mapper(rect, geo.x_domain, geo.y_domain);
  drawValueAxis(ctx, rect, geo.y_domain, d.valueLabel, ink, muted);
  drawPositions(ctx, rect, sx, d.labels, ink, muted);
  ctx.save();
  clipTo(ctx, rect);
  ctx.globalAlpha = LINE_ALPHA;
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  for (const [a, b] of geo.lines) {
    trace(ctx, [a, b], sx, sy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  (["before", "after"] as const).forEach((side, k) => {
    ctx.fillStyle = seriesColor(k);
    for (const [x, y] of geo[side]) {
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.5;
  for (const m of geo.means) {
    const x = sx(m.x);
    ctx.beginPath();
    ctx.moveTo(x, sy(m.lo));
    ctx.lineTo(x, sy(m.hi));
    ctx.moveTo(x - 4, sy(m.lo));
    ctx.lineTo(x + 4, sy(m.lo));
    ctx.moveTo(x - 4, sy(m.hi));
    ctx.lineTo(x + 4, sy(m.hi));
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x - 3.5, sy(m.mean) - 3.5, 7, 7);
    ctx.fill();
  }
  ctx.restore();
}

export function drawLollipop(ctx: CanvasRenderingContext2D, rect: Rect, d: LollipopDraw, ink: string, muted: string) {
  const geo = lollipopGeometry(d.series);
  const { sx, sy } = mapper(rect, geo.x_domain, geo.y_domain);
  drawValueAxis(ctx, rect, geo.y_domain, d.valueLabel, ink, muted);
  drawPositions(ctx, rect, sx, d.series.order.map((i) => d.labels[i] ?? `group ${i + 1}`), ink, muted);
  ctx.save();
  clipTo(ctx, rect);
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  trace(ctx, [[geo.x_domain[0], 0], [geo.x_domain[1], 0]], sx, sy);
  ctx.stroke();
  const color = seriesColor(0);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const [a, b] of geo.stems) {
    trace(ctx, [a, b], sx, sy);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const [x, y] of geo.dots) {
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), 4.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}
