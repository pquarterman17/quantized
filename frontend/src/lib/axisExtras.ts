// The Axis dialog's per-axis extras on the interactive canvas (figures-audit
// #6) -- the screen half of `calc/axis_extras.py`, so screen and export
// agree. Each lives on the axis' `AxisFormat` (see that type): `divide`
// (labels show value ÷ factor, "×factor" at the axis end), `minor` (minor
// ticks between majors), `ticks` (in/out/both), `size` (tick-label pt) and
// `base: "e"` (Origin's "Ln" scale on a log axis) and `breaks` (a broken
// linear Y / Y2 axis -- `lib/axisBreakExtras.ts`).
//
// `applyAxisExtras` edits the uPlot axes `uplotOpts.buildOpts` built and
// returns a draw plugin for what uPlot cannot draw itself (inward and minor
// ticks, the factor text), or null when no axis carries an extra -- so a
// plain plot is byte-for-byte the uPlot config it always was.
//
// Loaded on demand through `lib/axisExtrasHook.ts` (eager bundle budget).

import type uPlot from "uplot";

import { divideFont, divideLabelSpot, reserveDivideBand, type AxisSide } from "./axisDivideLabel";
import { activeBreaks, applyAxisBreaks, drawBreakMarks, insideBreak, type AxisExtrasContext } from "./axisBreakExtras";
import type { AxisBreak } from "./axisBreaks";
import { applyAxisLook, drawMinorGrid, drawSpine, lookFormat, topAxis, type AxisLook } from "./axisStyleExtras";
import { hasAxisExtras, type AxisFormat, type AxisScale } from "./types";

type TickValues = NonNullable<uPlot.Axis["values"]>;
type ValuesFn = Extract<TickValues, (...args: never[]) => unknown>;

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n: number): string => String(n).replace(/[-0-9]/g, (c) => SUP[c]);

/** "×10⁻³" for a power of ten, else "×2.5" -- `divide_offset_text`'s twin. */
export function divideLabel(divide: number): string {
  const exp = Math.log10(Math.abs(divide));
  return divide > 0 && Math.abs(exp - Math.round(exp)) < 1e-9 ? `×10${sup(Math.round(exp))}` : `×${divide}`;
}

/** Majors at whole powers of e inside [min, max] (an "Ln" axis). */
export function lnSplits(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const out: number[] = [];
  for (let k = Math.ceil(Math.log(min) - 1e-9); k <= Math.floor(Math.log(max) + 1e-9); k++) out.push(Math.exp(k));
  return out;
}

const lnValues: ValuesFn = (_u, splits) => splits.map((v) => (v > 0 ? `e${sup(Math.round(Math.log(v)))}` : ""));

function divided(values: TickValues | undefined, d: number): TickValues {
  if (typeof values !== "function") return (_u, splits) => splits.map((v) => (v == null ? null : String(Number((v / d).toPrecision(12)))));
  const inner = values as ValuesFn;
  // The increment stays the ORIGINAL one: matplotlib's formatter floors its
  // digits from the undivided tick locations too (calc/axis_extras.py).
  return (u, splits, axisIdx, space, incr) => inner(u, splits.map((v) => v / d), axisIdx, space, incr);
}

interface Extra {
  idx: number;
  fmt: AxisFormat;
  scale: AxisScale;
  /** The breaks this axis draws (null on x, off a linear scale, inherited). */
  breaks: readonly AxisBreak[] | null;
  /** Draw the break's diagonal marks (false on an inner x-break panel). */
  marks: boolean;
  /** Gap #5's axis look (offset, minor grid), or null (lib/axisStyleExtras.ts). */
  look: AxisLook | null;
}

/** Apply each axis' extras to `axes` (index-aligned with `fmts`/`scales`)
 *  and return the draw plugin, or null when there is nothing to draw. `ctx`
 *  (the scales and payload `buildOpts` is assembling) is what an axis BREAK
 *  needs; without it breaks are skipped and every other extra still applies. */
export function applyAxisExtras(
  axes: uPlot.Axis[],
  fmts: readonly (AxisFormat | null | undefined)[],
  scales: readonly AxisScale[],
  ink: string,
  ctx?: AxisExtrasContext,
): uPlot.Plugin | null {
  const extras: Extra[] = [];
  axes.forEach((axis, idx) => {
    const fmt = fmts[idx];
    if (!fmt || !hasAxisExtras(fmt)) return;
    const scale = scales[idx] ?? "linear";
    if (fmt.base === "e" && scale === "log") {
      axis.splits = (_u, _i, min, max) => lnSplits(min, max);
      axis.values = lnValues;
      delete axis.filter;
    }
    // Before divide-by, so the divided labels wrap the break's own formatter.
    const breaks = activeBreaks(idx, fmt.breaks, scale, ctx);
    if (breaks && ctx) applyAxisBreaks(axis, idx, breaks, ctx);
    if (fmt.divide && fmt.divide > 0 && fmt.divide !== 1) axis.values = divided(axis.values, fmt.divide);
    if (fmt.size && fmt.size > 0 && typeof axis.font === "string") {
      axis.font = axis.font.replace(/[\d.]+px/, `${Math.round((fmt.size * 96) / 72)}px`);
    }
    if (fmt.ticks === "in") axis.ticks = { ...axis.ticks, show: false };
    const look = applyAxisLook(axis, idx, lookFormat(fmt, idx, ctx), scale, ink, ctx);
    extras.push({ idx, fmt, scale, breaks, marks: ctx?.breakMarks !== false, look });
  });
  // Gap #5: a top X axis showing a transform of X (pushed last, so x/y/y2
  // keep their indices).
  const top = fmts[0]?.top;
  if (top && axes[0]) axes.push(topAxis(top, axes[0]));
  return extras.length ? axisExtrasPlugin(extras, ink) : null;
}

function axisExtrasPlugin(extras: readonly Extra[], ink: string): uPlot.Plugin {
  const dividedAxes = extras.filter((e) => e.fmt.divide && e.fmt.divide > 0 && e.fmt.divide !== 1).map((e) => e.idx);
  return {
    // A band above the frame for a Y / Y2 factor, so it is never clipped.
    ...(dividedAxes.length ? { opts: (_u: uPlot, o: uPlot.Options) => reserveDivideBand(o, dividedAxes) } : {}),
    hooks: {
      // Minor grid lines go under the series, as uPlot's own grid does.
      drawAxes: (u: uPlot) => {
        for (const { idx, look } of extras) {
          if (!look?.minorGrid) continue;
          const axis = u.axes[idx] as uPlot.Axis & { _splits?: number[] };
          const side: number = axis.side ?? (idx === 0 ? 2 : 3);
          const majors = (axis._splits ?? []).filter((v) => Number.isFinite(v));
          drawMinorGrid(u, axis.scale ?? (idx === 0 ? "x" : "y"), side === 0 || side === 2, majors, look.minorGrid);
        }
      },
      draw: (u: uPlot) => {
        const { ctx } = u;
        const pr = devicePixelRatio || 1;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = pr;
        for (const { idx, fmt, scale, breaks, marks, look } of extras) {
          const axis = u.axes[idx] as uPlot.Axis & { _splits?: number[] };
          const key = axis.scale ?? (idx === 0 ? "x" : "y");
          // uPlot's Side enum as plain numbers: 0 top, 1 right, 2 bottom, 3 left.
          const side: number = axis.side ?? (idx === 0 ? 2 : 3);
          const horizontal = side === 0 || side === 2;
          const inward = side === 2 || side === 1 ? -1 : 1;
          // An offset axis (gap #5) sits `look.offset` css px outside the frame.
          const off = (look?.offset ?? 0) * pr;
          const edge = (side === 2 ? top + height : side === 3 ? left : side === 1 ? left + width : top) - inward * off;
          const tick = (v: number, len: number, dir: number) => {
            const p = u.valToPos(v, key, true);
            if (!Number.isFinite(p)) return;
            ctx.beginPath();
            if (horizontal) {
              ctx.moveTo(p, edge);
              ctx.lineTo(p, edge + dir * len * pr);
            } else {
              ctx.moveTo(edge, p);
              ctx.lineTo(edge + dir * len * pr, p);
            }
            ctx.stroke();
          };
          const majors = (axis._splits ?? []).filter((v) => Number.isFinite(v));
          const wantIn = fmt.ticks === "in" || fmt.ticks === "both";
          const wantOut = fmt.ticks !== "in";
          if (wantIn) for (const v of majors) tick(v, 6, inward);
          if (off && look) {
            // uPlot's own ticks are hidden on an offset axis: redraw them here.
            drawSpine(u, horizontal, edge, ink);
            ctx.strokeStyle = look.tickStroke;
            if (wantOut) for (const v of majors) tick(v, 10, -inward);
            ctx.strokeStyle = ink;
          }
          if (fmt.minor && fmt.minor > 0 && scale === "linear" && majors.length > 1) {
            const step = (majors[1] - majors[0]) / (fmt.minor + 1);
            const lo = majors[0] - step * fmt.minor;
            for (let v = lo; v <= majors[majors.length - 1] + step * fmt.minor; v += step) {
              if (majors.some((m) => Math.abs(m - v) < step / 2)) continue;
              if (breaks && insideBreak(v, breaks)) continue; // no tick in the elided stretch
              if (wantIn) tick(v, 3, inward);
              if (wantOut) tick(v, 3, -inward);
            }
          }
          if (breaks && marks && !horizontal) drawBreakMarks(u, key, edge, breaks, pr);
          if (fmt.divide && fmt.divide > 0 && fmt.divide !== 1) {
            // Outside the frame, where the export's offset text sits, in the
            // axis' own tick font (lib/axisDivideLabel.ts): inside the corner
            // it was small and under the legend.
            const f = divideFont(axis.font, pr);
            const at = divideLabelSpot(side as AxisSide, { left, top, width, height }, pr, f.px);
            ctx.font = f.font;
            ctx.textAlign = at.align;
            ctx.textBaseline = at.baseline;
            ctx.fillText(divideLabel(fmt.divide), at.x, at.y);
          }
        }
        ctx.restore();
      },
    },
  };
}
