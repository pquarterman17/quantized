// The canvas half of Origin-style multiple Y axes (gap audit 4 G11, model in
// lib/multiY.ts): one uPlot scale + right-side axis per extra Y axis in play.
//
// Geometry: uPlot lays right-side axes out from the frame in array order,
// each taking its tick band (`size`) plus its title band (`labelSize`). So
// sizing every right axis but the outermost to exactly one MULTI_Y_SLOT_PT
// slot puts the k-th right axis k slots out -- the same outward offsets the
// export gives each matplotlib twin spine (calc/figure_multi_y.py).

import type uPlot from "uplot";

import type { AxisFormat, AxisScale } from "./types";
import { MULTI_Y_SLOT_PT, type ResolvedExtraY } from "./multiY";
import { errorRange, fullYExtents, type BarEnds } from "./uplotErrorRange";
import type { PlotPayload } from "./plotdata";
import { logMajorTickFilter } from "./logTicks";

type Splits = (scale: AxisScale, lim: [number, number] | null, step: number | null) => uPlot.Axis.Splits | undefined;

export interface MultiYContext {
  /** The shared axis look (font, title band, ink). */
  axis: uPlot.Axis;
  payload: PlotPayload;
  hidden?: boolean[];
  reach: BarEnds[] | null;
  /** Non-monotonic X: scan the full extents (as Y / Y2 do). */
  scan: boolean;
  values: (fmt: AxisFormat, scale: AxisScale) => uPlot.Axis["values"];
  splits: Splits;
  /** The automatic tick density of a linear numeric axis (lib/uplotRightPad.ts). */
  space: (scale: AxisScale, fmt: AxisFormat) => uPlot.Axis["space"] | undefined;
  distr: (scale: AxisScale) => Pick<uPlot.Scale, "distr" | "fwd" | "bwd">;
  /** The derived title of payload axis `which` (one series: its name). */
  label: (which: number) => string | undefined;
  /** The axis-extras lists (format, scale, typed range, step) per axis, with a
   *  Y2 slot whether or not there is a Y2: aligned to `axes` here. */
  look: unknown[][];
}

const positive = (s: AxisScale) => s === "log" || s === "reciprocal";

/** Add each of `extra`'s scales and axes. Returns the slot sizing, which the
 *  caller runs AFTER the axis-extras applier: an axis the applier grew (a
 *  gap-#5 offset on Y2) must still take exactly one slot, or every axis
 *  outside it sits further out than the export's `SLOT_PT * k`. */
export function pushExtraYAxes(scales: uPlot.Scales, axes: uPlot.Axis[], extra: readonly ResolvedExtraY[], ctx: MultiYContext): () => void {
  const [fmts, kinds, typed, steps] = ctx.look;
  // Read off what the caller already built: a Y2 scale exists exactly when
  // there is a Y2, and Y1's axis (axes[1]) carries the measured tick band
  // (the outermost axis keeps it).
  if (!scales.y2) for (const l of ctx.look) l.length = 2;
  const size = axes[1].size;
  fmts.push(...extra.map((a) => a.fmt));
  kinds.push(...extra.map((a) => a.scale));
  typed.push(...extra.map((a) => !!a.lim));
  steps.push(...extra.map((a) => a.step));
  for (const a of extra) {
    const which = a.n - 1;
    const loop = ctx.scan ? fullYExtents(ctx.payload, ctx.hidden, which, positive(a.scale), ctx.reach) : null;
    scales[`y${a.n}`] = {
      ...ctx.distr(a.scale),
      ...(a.lim ? { range: a.lim } : loop ? { range: () => loop } : errorRange(ctx.reach, which, positive(a.scale))),
    };
    const ink = a.color ?? (ctx.axis.stroke as string);
    const values = ctx.values(a.fmt, a.scale);
    const splits = ctx.splits(a.scale, a.lim, a.step);
    const space = ctx.space(a.scale, a.fmt);
    axes.push({
      ...ctx.axis,
      scale: `y${a.n}`,
      side: 1,
      size,
      label: a.label ?? ctx.label(which) ?? "",
      grid: { show: false },
      stroke: ink,
      ticks: { ...ctx.axis.ticks, stroke: ink },
      // Off the frame, an axis needs its own line.
      border: { show: true, stroke: ink, width: 1 },
      ...(values ? { values } : {}),
      ...(splits ? { splits } : {}),
      ...(space ? { space } : {}),
      ...(a.scale === "log" ? { filter: logMajorTickFilter } : {}),
    });
  }
  // Y2 takes a slot only with a DRAWN series (the export draws no Y2 axis
  // when every Y2 series is hidden).
  const y2 = axes.find((ax) => ax.scale === "y2");
  if (y2 && !ctx.payload.series.some((sr, i) => sr.axis === 1 && !ctx.hidden?.[i])) y2.show = false;
  return () => {
    const slot = (MULTI_Y_SLOT_PT * 96) / 72;
    const right = axes.filter((ax) => Number(ax.side) === 1 && ax.show !== false);
    for (const ax of right.slice(0, -1)) ax.size = slot - (ax.label != null ? (ax.labelSize ?? 30) : 0);
  };
}
