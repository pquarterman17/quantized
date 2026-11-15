// The Axis dialog's axis-look fields on the interactive canvas (gap-audit-2
// #5) -- the screen half of `calc/axis_style.py`, so screen and export agree:
//   reverse  a Y / Y2 axis drawn high-to-low (uPlot scale `dir: -1`);
//   grid     this axis' own major/minor grid, colour and dash;
//   rotate   X tick labels rotated counter-clockwise (uPlot draws rotated
//            labels on the bottom axis only, so the dialog offers X only);
//   offset   the axis line, ticks and labels pushed outward by N pt; the
//            frame stays where it is, as in Origin and the export;
//   top      a second X axis along the top (`lib/axisTop.ts`).
// Called per axis by `lib/axisExtras.ts` (and so loaded on demand with it).

import type uPlot from "uplot";

import { inheritedAxisFormat, type AxisFormat, type AxisGrid, type TopAxis } from "./axisFormat";
import type { AxisExtrasContext } from "./axisBreakExtras";
import { topTicks, type TopTick } from "./axisTop";

/** Grid dash patterns, css px: the export's `DASHES` (pt) at 96/72. */
export const GRID_DASH: Record<NonNullable<AxisGrid["dash"]>, number[]> = {
  solid: [],
  dash: [5.3, 3.3],
  dot: [1.3, 2.7],
};

/** pt -> css px, as the tick-label size converts. */
export const ptToPx = (pt: number): number => (pt * 96) / 72;

/** What the draw pass needs to know about one styled axis. */
export interface AxisLook {
  /** Outward offset, css px (0 = none). */
  offset: number;
  /** Minor grid lines to draw (null = none). */
  minorGrid: { stroke: string; dash: number[]; per: number } | null;
  /** The tick colour uPlot would have used (for the ticks drawn here). */
  tickStroke: string;
}

/** The axis-look part of axis `idx`'s format: a Y2 axis with no format of
 *  its own inherits Y's number format but none of Y's own look. */
export function lookFormat(fmt: AxisFormat, idx: number, ctx?: AxisExtrasContext): AxisFormat {
  return idx === 2 && ctx && !ctx.y2Own ? inheritedAxisFormat(fmt) : fmt;
}

type SizeFn = Extract<NonNullable<uPlot.Axis["size"]>, (...args: never[]) => unknown>;

function growSize(axis: uPlot.Axis, by: (u: uPlot, values: string[]) => number): void {
  const base = axis.size;
  axis.size = (u, values, idx, cycle) => {
    const b = typeof base === "function" ? (base as SizeFn)(u, values, idx, cycle) : base ?? 50;
    return b + by(u, values ?? []);
  };
}

/** Apply `fmt`'s look fields to `axis` (and its scale in `ctx.scales`);
 *  returns what the draw pass must add, or null when nothing applies. */
export function applyAxisLook(axis: uPlot.Axis, idx: number, fmt: AxisFormat, scale: string, ink: string, ctx?: AxisExtrasContext): AxisLook | null {
  const tickStroke = typeof axis.ticks?.stroke === "string" ? axis.ticks.stroke : ink;
  let minorGrid: AxisLook["minorGrid"] = null;
  if (fmt.reverse && idx > 0 && ctx) {
    const key = axis.scale ?? (idx === 1 ? "y" : "y2");
    ctx.scales[key] = { ...ctx.scales[key], dir: -1 };
  }
  if (fmt.grid) {
    const stroke = fmt.grid.color ?? tickStroke;
    const dash = GRID_DASH[fmt.grid.dash ?? "solid"];
    axis.grid = { show: fmt.grid.major, stroke, width: 1, dash };
    if (fmt.grid.minor && scale === "linear") minorGrid = { stroke, dash, per: fmt.minor && fmt.minor > 0 ? fmt.minor : 1 };
  }
  if (idx === 0 && fmt.rotate) {
    const rad = (Math.abs(fmt.rotate) * Math.PI) / 180;
    axis.rotate = fmt.rotate;
    const font = typeof axis.font === "string" ? axis.font : "12px sans-serif";
    const px = Number(/([\d.]+)px/.exec(font)?.[1] ?? 12);
    // A rotated label is w·sin + h·cos tall, where a flat one was h.
    growSize(axis, (u, values) => {
      const ctx2 = u.ctx;
      const prev = ctx2.font;
      ctx2.font = font;
      const w = Math.max(0, ...values.map((v) => (v == null ? 0 : ctx2.measureText(String(v)).width)));
      ctx2.font = prev;
      return Math.max(0, Math.ceil(w * Math.sin(rad) + px * Math.cos(rad) - px));
    });
  }
  const offset = fmt.offset && fmt.offset > 0 ? ptToPx(fmt.offset) : 0;
  if (offset) {
    // uPlot's own ticks hug the frame: hide them (the draw pass redraws them
    // on the moved axis line) and push the labels out by the same amount.
    const tickSize = axis.ticks?.show === false ? 0 : (axis.ticks?.size ?? 10);
    axis.ticks = { ...axis.ticks, show: false };
    axis.gap = (axis.gap ?? 5) + tickSize + offset;
    growSize(axis, () => offset);
  }
  return offset || minorGrid || fmt.reverse || fmt.grid || fmt.rotate ? { offset, minorGrid, tickStroke } : null;
}

/** The top X axis `top` describes, styled like the bottom axis `base`. */
export function topAxis(top: TopAxis, base: uPlot.Axis): uPlot.Axis {
  let last: TopTick[] = [];
  const font = typeof base.font === "string" ? base.font : "12px sans-serif";
  const px = Number(/([\d.]+)px/.exec(font)?.[1] ?? 12);
  return {
    scale: "x",
    side: 0,
    stroke: base.stroke,
    font: base.font,
    labelFont: base.labelFont,
    ...(top.title ? { label: top.title, labelSize: base.labelSize } : {}),
    size: Math.ceil(px + 20),
    grid: { show: false },
    ...(base.ticks ? { ticks: { ...base.ticks, show: true } } : {}),
    splits: (_u, _i, min, max) => (last = topTicks(top, min, max)).map((t) => t.pos),
    values: () => last.map((t) => t.label),
  };
}

/** Minor grid lines between the majors `majors` of the axis drawn on scale
 *  `key` (horizontal = an x axis' vertical lines). Before the series. */
export function drawMinorGrid(u: uPlot, key: string, horizontal: boolean, majors: readonly number[], grid: NonNullable<AxisLook["minorGrid"]>): void {
  if (majors.length < 2) return;
  const { ctx } = u;
  const pr = devicePixelRatio || 1;
  const { left, top, width, height } = u.bbox;
  const step = (majors[1] - majors[0]) / (grid.per + 1);
  ctx.save();
  ctx.strokeStyle = grid.stroke;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = pr;
  ctx.setLineDash(grid.dash.map((d) => d * pr));
  for (let v = majors[0] - step * grid.per; v <= majors[majors.length - 1] + step * grid.per; v += step) {
    if (majors.some((m) => Math.abs(m - v) < step / 2)) continue;
    const p = u.valToPos(v, key, true);
    if (!Number.isFinite(p)) continue;
    if (horizontal ? p < left || p > left + width : p < top || p > top + height) continue;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(p, top);
      ctx.lineTo(p, top + height);
    } else {
      ctx.moveTo(left, p);
      ctx.lineTo(left + width, p);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The moved axis line of an offset axis, at `edge` (device px). */
export function drawSpine(u: uPlot, horizontal: boolean, edge: number, stroke: string): void {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.setLineDash([]);
  ctx.lineWidth = devicePixelRatio || 1;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(left, edge);
    ctx.lineTo(left + width, edge);
  } else {
    ctx.moveTo(edge, top);
    ctx.lineTo(edge, top + height);
  }
  ctx.stroke();
  ctx.restore();
}
