// The Axis dialog's extra scales and tick rules on the interactive canvas
// (gap audit 4 G17) -- the screen half of `calc/axis_scales.py`; the shared
// math is `lib/axisScales.ts`. Called per axis by `lib/axisExtras.ts` (and so
// loaded on demand with it):
//   log2         majors at powers of 2 on a log axis;
//   probability  a linear axis turned into a probit scale (uPlot `distr: 100`)
//                with Origin's standard majors and auto range;
//   custom       explicit majors, labelled where the user gave a label;
//   cross        the axis drawn across the other axis at a value. uPlot still
//                lays the axis out (so the frame does not move) but draws no
//                ticks or labels; the draw pass draws them at the crossing.

import type uPlot from "uplot";

import type { AxisFormat } from "./axisFormat";
import type { AxisExtrasContext } from "./axisBreakExtras";
import { divideFont } from "./axisDivideLabel";
import {
  crossPosition, customTicksIn, drawableOn, inProbDomain, log2Label, log2Ticks, plainLabel,
  probAutoRange, probBackward, probForward, probTicks, type ProbUnit,
} from "./axisScales";

type ValuesFn = Extract<NonNullable<uPlot.Axis["values"]>, (...args: never[]) => unknown>;
type SizeFn = Extract<NonNullable<uPlot.Axis["size"]>, (...args: never[]) => unknown>;

const keyOf = (axis: uPlot.Axis, idx: number): string => axis.scale ?? (idx === 0 ? "x" : idx === 1 ? "y" : "y2");

/** An axis filter that keeps every split's label (custom majors already are
 *  exactly the ticks to label). */
export const keepEveryLabel: NonNullable<uPlot.Axis["filter"]> = (_u, splits) => splits;

/** The drawn scale of an axis: "probit" for a probability axis. */
export function effectiveScale(scale: string, fmt: AxisFormat): string {
  return scale === "linear" && fmt.prob ? "probit" : scale;
}

/** Finite in-domain min/max of what axis `idx` draws (x = data[0]). */
export function probExtent(payload: AxisExtrasContext["payload"], idx: number, unit: ProbUnit, hidden?: readonly boolean[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const scan = (col: ArrayLike<number | null | undefined>) => {
    for (let r = 0; r < col.length; r++) {
      const v = col[r];
      if (v != null && inProbDomain(v, unit)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  };
  if (idx === 0) scan(payload.data[0] ?? []);
  else {
    for (let s = 1; s < payload.data.length; s++) {
      if ((payload.series[s - 1]?.axis ?? 0) !== idx - 1 || hidden?.[s - 1]) continue;
      scan(payload.data[s]);
    }
  }
  return hi >= lo ? [lo, hi] : null;
}

function applyProb(axis: uPlot.Axis, idx: number, unit: ProbUnit, ctx: AxisExtrasContext): void {
  const key = keyOf(axis, idx);
  const prev = ctx.scales[key] ?? {};
  // Its own series by scale key (x / y / y2 / y3 ...), so a Y3+ axis (lib/multiY.ts) reads its own.
  const extent = probExtent(ctx.payload, key === "x" ? 0 : key === "y" ? 1 : Number(key.slice(1)), unit, ctx.hidden);
  const auto = (): uPlot.Range.MinMax => probAutoRange(extent?.[0] ?? null, extent?.[1] ?? null, unit);
  const typed = prev.range;
  ctx.scales[key] = {
    ...prev,
    distr: 100,
    fwd: (v: number) => probForward(v, unit),
    bwd: (z: number) => probBackward(z, unit),
    // A typed limit off the domain cannot be drawn: that side is auto.
    range: (u, dMin, dMax) => {
      if (!ctx.typed[idx] || typed == null) return auto();
      const got = typeof typed === "function" ? typed(u, dMin, dMax, key) : typed;
      const r: readonly (number | null)[] = Array.isArray(got) ? got : [null, null];
      const [a, b] = auto() as [number, number];
      const side = (v: number | null, d: number): number => (v != null && inProbDomain(v, unit) ? v : d);
      const lo = side(r[0], a);
      const hi = side(r[1], b);
      return lo < hi ? [lo, hi] : [a, b];
    },
  };
  axis.splits = (_u, _i, min, max) => probTicks(min, max, unit);
  axis.values = (_u, splits) => splits.map((v) => (v == null ? "" : plainLabel(v)));
  // uPlot's default filter for distr >= 3 keeps only 1/2/5 x 10^n.
  axis.filter = (_u, splits) => splits;
}

/** The smallest gap between consecutive splits (the formatter's increment). */
function drawnIncrement(splits: readonly number[], fallback: number): number {
  let d = Infinity;
  for (let i = 1; i < splits.length; i++) d = Math.min(d, Math.abs(splits[i] - splits[i - 1]));
  return d > 0 && Number.isFinite(d) ? d : fallback;
}

function applyCustom(axis: uPlot.Axis, fmt: AxisFormat, scale: string, skip: (v: number) => boolean): void {
  const custom = fmt.custom;
  if (!custom) return;
  const ok = (v: number) => drawableOn(v, scale === "probit" ? "linear" : scale, fmt) && !skip(v);
  const labels = new Map<number, string>();
  custom.at.forEach((v, i) => {
    const l = custom.labels?.[i];
    if (l?.trim() && !labels.has(v)) labels.set(v, l);
  });
  axis.splits = (_u, _i, min, max) => customTicksIn(custom, min, max, ok).at;
  axis.filter = (_u, splits) => splits;
  const inner = typeof axis.values === "function" ? (axis.values as ValuesFn) : null;
  axis.values = (u, splits, axisIdx, space, incr) => {
    const base = inner ? inner(u, splits, axisIdx, space, drawnIncrement(splits, incr)) : splits.map((v) => plainLabel(v));
    return splits.map((v, i) => labels.get(v) ?? base[i]);
  };
}

/** What the draw pass needs for an axis that crosses the other axis. */
export interface CrossLook {
  cross: number;
  /** The labels uPlot would have drawn for the current splits. */
  labels: () => readonly string[];
  tickSize: number;
  gap: number;
}

function applyCross(axis: uPlot.Axis, cross: number): CrossLook {
  const inner = typeof axis.values === "function" ? (axis.values as ValuesFn) : null;
  let last: string[] = [];
  axis.values = (u, splits, axisIdx, space, incr) => {
    const real = inner ? inner(u, splits, axisIdx, space, incr) : splits.map((v) => plainLabel(v));
    last = real.map((v) => (v == null ? "" : String(v)));
    return last.map(() => "");
  };
  // The frame keeps the space the labels take, as the export keeps it: size
  // the axis from the real labels, not the blanks uPlot is handed.
  const base = axis.size;
  axis.size = (u, values, idx, cycle) => {
    const v = last.length ? last : values;
    return typeof base === "function" ? (base as SizeFn)(u, v, idx, cycle) : base ?? 50;
  };
  const tickSize = axis.ticks?.show === false ? 0 : axis.ticks?.size ?? 10;
  axis.ticks = { ...axis.ticks, show: false };
  return { cross, labels: () => last, tickSize, gap: axis.gap ?? 5 };
}

/** Apply `fmt`'s G17 extras that must come BEFORE breaks and divide-by (the
 *  scale and its majors). `fmt` is the axis' own (a Y2 axis' inherited one
 *  carries none). Returns the drawn scale. */
export function applyScaleExtras(axis: uPlot.Axis, idx: number, fmt: AxisFormat, scale: string, ctx?: AxisExtrasContext): string {
  if (scale === "log" && fmt.base === "2") {
    axis.splits = (_u, _i, min, max) => log2Ticks(min, max);
    axis.values = (_u, splits) => splits.map((v) => (v == null ? "" : log2Label(v)));
    // Every major keeps its label: with no filter uPlot falls back to its
    // decade filter on a log scale, which blanked 4, 8, 64 ... while the
    // export labels every power of 2 (found by the multi-Y wire fixture).
    axis.filter = keepEveryLabel;
  }
  if (effectiveScale(scale, fmt) !== "probit" || !fmt.prob || !ctx) return scale;
  applyProb(axis, idx, fmt.prob, ctx);
  return "probit";
}

/** Apply `fmt`'s G17 extras that come AFTER divide-by: custom majors (their
 *  labels replace the divided numbers) and the crossing (last, so it draws
 *  whatever labels the axis ends up with). */
export function applyTickExtras(axis: uPlot.Axis, fmt: AxisFormat, scale: string, skip: (v: number) => boolean): CrossLook | null {
  applyCustom(axis, fmt, scale, skip);
  return fmt.cross !== undefined && Number.isFinite(fmt.cross) ? applyCross(axis, fmt.cross) : null;
}

const strokeOf = (axis: uPlot.Axis, u: uPlot, idx: number, ink: string): string => {
  const s = axis.stroke as unknown;
  if (typeof s === "function") return String((s as (u: uPlot, i: number) => unknown)(u, idx));
  return typeof s === "string" ? s : ink;
};

/** Draw axis `idx`'s line, ticks and labels across the other axis. */
export function drawCross(u: uPlot, idx: number, look: CrossLook, ink: string): void {
  const axis = u.axes[idx] as uPlot.Axis & { _splits?: number[] };
  const key = keyOf(axis, idx);
  const other = idx === 0 ? "y" : "x";
  const os = u.scales[other];
  const pr = devicePixelRatio || 1;
  const { left, top, width, height } = u.bbox;
  const side: number = axis.side ?? (idx === 0 ? 2 : idx === 2 ? 1 : 3);
  const horizontal = side === 0 || side === 2;
  const at = crossPosition(look.cross, os?.min ?? NaN, os?.max ?? NaN, Number.isFinite(u.valToPos(look.cross, other, true)));
  const frame = side === 2 ? top + height : side === 0 ? top : side === 1 ? left + width : left;
  const edge = at === null ? frame : u.valToPos(at, other, true);
  // Ticks and labels face the axis' own side: left of a left Y, below an X.
  const out = side === 2 || side === 1 ? 1 : -1;
  const { ctx } = u;
  const color = strokeOf(axis, u, idx, ink);
  const f = divideFont(axis.font, pr);
  const splits = (axis._splits ?? []).map((v, i) => [v, look.labels()[i] ?? ""] as const).filter(([v]) => Number.isFinite(v));
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = pr;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(left, edge);
    ctx.lineTo(left + width, edge);
  } else {
    ctx.moveTo(edge, top);
    ctx.lineTo(edge, top + height);
  }
  ctx.stroke();
  ctx.font = f.font;
  ctx.fillStyle = color;
  ctx.textAlign = horizontal ? "center" : out > 0 ? "left" : "right";
  ctx.textBaseline = horizontal ? (out > 0 ? "top" : "bottom") : "middle";
  const tick = look.tickSize * pr;
  const lab = (look.tickSize + look.gap) * pr;
  for (const [v, label] of splits) {
    const p = u.valToPos(v, key, true);
    if (!Number.isFinite(p)) continue;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(p, edge);
      ctx.lineTo(p, edge + out * tick);
    } else {
      ctx.moveTo(edge, p);
      ctx.lineTo(edge + out * tick, p);
    }
    ctx.stroke();
    if (label) {
      if (horizontal) ctx.fillText(label, p, edge + out * lab);
      else ctx.fillText(label, edge + out * lab, p);
    }
  }
  ctx.restore();
}
