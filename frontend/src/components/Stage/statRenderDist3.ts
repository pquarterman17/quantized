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
  type ViolinMarks,
} from "../../lib/statDist3";
import { directionColors } from "../../lib/statDirection";
import { seriesColor } from "../../lib/uplotOpts";
import { LEGEND_ROW, legendSpot, segmentPoints } from "./statLegendSpot";
import { drawNumericXAxis, drawValueAxis, type Rect } from "./statRender";

export const SIDE_FILL_ALPHA = 0.7;
const LINE_ALPHA = 0.5;
const DIRECTION_ALPHA = 0.8;
const RAIN_ALPHA = 0.6;

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
  /** Inner median / quartile lines, stamped on after the compute (`statDist3Stamp`). */
  innerMarks?: ViolinMarks;
  /** A mean marker on each violin, and the raw points beside a half violin (stamped on). */
  meanMarker?: boolean;
  rain?: boolean;
  valueLabel: string;
}
export interface PairedDraw {
  mode: "paired";
  series: PairedSeries;
  ci: boolean;
  /** Colour each subject's line by up / down / same, with a legend (stamped on). */
  direction?: boolean;
  /** The absolute "no change" tolerance of the direction (stamped on; 0 = exact equality). */
  tol?: number;
  labels: [string, string];
  valueLabel: string;
}
export interface LollipopDraw {
  mode: "lollipop";
  series: LollipopSeries;
  groups: number[][];
  labels: string[];
  /** Categories down the Y axis, a dot chart (stamped on). */
  horizontal?: boolean;
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
  const geo = sideViolinGeometry(d.wire, d.positions, d.sides, d.style, d.groups, d.innerMarks, { mean: d.meanMarker, rain: d.rain && d.style === "half" });
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
    if (v.rain) {
      ctx.globalAlpha = RAIN_ALPHA;
      ctx.fillStyle = color;
      for (const [x, y] of v.rain) {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    for (const m of v.marks ?? []) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = m.name === "median" ? 2 : 1;
      ctx.setLineDash(m.name === "median" ? [] : [4, 3]);
      trace(ctx, [[m.x[0], m.y], [m.x[1], m.y]], sx, sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (v.mean) {
      const [cx, cy] = [sx(v.mean.x), sy(v.mean.y)];
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx + 5, cy);
      ctx.lineTo(cx, cy + 5);
      ctx.lineTo(cx - 5, cy);
      ctx.closePath();
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
  if (d.style === "split" && d.levels.length) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // Clear of the shapes: the corner with the fewest violin vertices under the key.
    const spot = legendSpot(rect, d.levels.length, geo.violins.flatMap((v) => v.fill.map(([x, y]): [number, number] => [sx(x), sy(y)])));
    d.levels.forEach((name, k) => {
      const y = spot.y + k * LEGEND_ROW;
      ctx.globalAlpha = SIDE_FILL_ALPHA;
      ctx.fillStyle = seriesColor(k);
      ctx.fillRect(spot.x, y - 5, 10, 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.fillText(name, spot.x + 16, y);
    });
  }
}

export function drawPaired(ctx: CanvasRenderingContext2D, rect: Rect, d: PairedDraw, ink: string, muted: string) {
  const geo = pairedGeometry(d.series, d.ci, !!d.direction, d.tol ?? 0);
  const { sx, sy } = mapper(rect, geo.x_domain, geo.y_domain);
  drawValueAxis(ctx, rect, geo.y_domain, d.valueLabel, ink, muted);
  drawPositions(ctx, rect, sx, d.labels, ink, muted);
  ctx.save();
  clipTo(ctx, rect);
  const dirs = geo.directions ? (directionColors() ?? [muted, muted, muted]) : null;
  ctx.globalAlpha = dirs ? DIRECTION_ALPHA : LINE_ALPHA;
  ctx.lineWidth = dirs ? 1.2 : 1;
  geo.lines.forEach(([a, b], i) => {
    // the theme ink: the dim text colour is near-invisible against the dark plot
    ctx.strokeStyle = dirs ? dirs[["up", "down", "same"].indexOf(geo.directions![i])] : ink;
    trace(ctx, [a, b], sx, sy);
    ctx.stroke();
  });
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
  if (dirs && geo.legend) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const spot = legendSpot(rect, geo.legend.length, geo.lines.flatMap((l) => l.map(([x, y]): [number, number] => [sx(x), sy(y)])));
    geo.legend.forEach((row, k) => {
      const y = spot.y + k * LEGEND_ROW;
      ctx.strokeStyle = dirs[k];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(spot.x, y);
      ctx.lineTo(spot.x + 12, y);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(row.label, spot.x + 18, y);
    });
  }
}

/** The left margin a horizontal lollipop needs for its category names (6 px a character). */
export function lollipopLeft(d: LollipopDraw, w: number, base: number): number {
  const longest = Math.max(0, ...d.labels.map((s) => s.length));
  return Math.min(Math.max(base, 6 * longest + 14), Math.max(base, w * 0.35));
}

/** Category names right-aligned at the left of the plot, one per Y position. */
function drawPositionsY(ctx: CanvasRenderingContext2D, rect: Rect, sy: (v: number) => number, at: readonly number[], names: readonly string[], ink: string, muted: string) {
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  ctx.strokeStyle = muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const room = Math.max(3, Math.floor((rect.x - 12) / 6));
  at.forEach((p, k) => {
    ctx.beginPath();
    ctx.moveTo(rect.x - 4, sy(p));
    ctx.lineTo(rect.x, sy(p));
    ctx.stroke();
    ctx.fillText(names[k].length > room ? `${names[k].slice(0, room - 1)}…` : names[k], rect.x - 6, sy(p));
  });
  ctx.fillStyle = ink;
}

/** The lollipop's Y title, on screen and in the export: what each dot is ("mean of v"). */
export const lollipopYLabel = (d: Pick<LollipopDraw, "series" | "valueLabel">): string => `${d.series.stat} of ${d.valueLabel}`;

export function drawLollipop(ctx: CanvasRenderingContext2D, rect: Rect, d: LollipopDraw, ink: string, muted: string) {
  const horizontal = !!d.horizontal;
  const geo = lollipopGeometry(d.series, horizontal);
  const { sx, sy } = mapper(rect, geo.x_domain, geo.y_domain);
  const names = d.series.order.map((i) => d.labels[i] ?? `group ${i + 1}`);
  if (geo.positions) {
    drawNumericXAxis(ctx, rect, geo.x_domain, lollipopYLabel(d), ink, muted);
    drawPositionsY(ctx, rect, sy, geo.positions, names, ink, muted);
  } else {
    drawValueAxis(ctx, rect, geo.y_domain, lollipopYLabel(d), ink, muted);
    drawPositions(ctx, rect, sx, names, ink, muted);
  }
  ctx.save();
  clipTo(ctx, rect);
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  trace(ctx, horizontal ? [[0, geo.y_domain[0]], [0, geo.y_domain[1]]] : [[geo.x_domain[0], 0], [geo.x_domain[1], 0]], sx, sy);
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
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  for (const [a, b] of geo.whiskers ?? []) {
    trace(ctx, [a, b], sx, sy);
    ctx.stroke();
  }
  ctx.restore();
  if (geo.legend) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const whiskers = (geo.whiskers ?? []).map(([a, b]): [[number, number], [number, number]] => [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]]);
    const spot = legendSpot(rect, 1, [...geo.dots.map(([x, y]): [number, number] => [sx(x), sy(y)]), ...segmentPoints(whiskers)]);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(spot.x, spot.y);
    ctx.lineTo(spot.x + 12, spot.y);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillText(geo.legend, spot.x + 18, spot.y);
  }
}
