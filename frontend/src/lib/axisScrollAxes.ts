// The axes the Graph browser's scroller can move (plan item 22): X, Y, the secondary Y2, and every extra right
// axis Y3..Y8 (lib/multiYModel.ts). One place says, for a view, which axis is which: its fixed window, how it is
// laid out (linear, log, 1/x, probit) and what values it can draw, so the scroller, its extent and the write-back
// cannot disagree. Pure: the view comes in as a plain object.

import type { AxisFormat } from "./axisFormat";
import type { Drawable, ScrollKind } from "./axisScroll";
import type { HalfLim } from "./axisLim";
import type { ExtraYAxis } from "./multiYModel";
import type { AxisScale } from "./types";

export type ScrollAxisName = "x" | "y" | "y2" | `y${3 | 4 | 5 | 6 | 7 | 8}`;

/** The fields of a plot view the scroller reads. */
export interface ScrollView {
  xScale: AxisScale; yScale: AxisScale; y2Scale: AxisScale | null;
  xFmt: AxisFormat; yFmt: AxisFormat; y2Fmt: AxisFormat | null;
  xLim: HalfLim | null; yLim: HalfLim | null; y2Lim: HalfLim | null;
  y2Keys: readonly number[] | null;
  yAxes: readonly ExtraYAxis[]; yAxisOf: Readonly<Record<number, number>>;
}

/** The axis number behind a name: X is 0, Y 1, Y2 2, Y3 3 ... */
export const axisNumberOf = (axis: ScrollAxisName): number => (axis === "x" ? 0 : axis === "y" ? 1 : Number(axis.slice(1)));

/** `axis`'s configuration: its scale, its own number format (a probability axis is set on the axis' own format, it is
 *  never inherited) and its window. An extra axis with no scale of its own takes Y1's, as it draws. */
function axisOf(v: ScrollView, axis: ScrollAxisName): { scale: AxisScale; fmt: AxisFormat | null; lim: HalfLim | null } {
  if (axis === "x") return { scale: v.xScale, fmt: v.xFmt, lim: v.xLim };
  if (axis === "y") return { scale: v.yScale, fmt: v.yFmt, lim: v.yLim };
  if (axis === "y2") return { scale: v.y2Scale ?? "linear", fmt: v.y2Fmt, lim: v.y2Lim };
  const extra = v.yAxes[axisNumberOf(axis) - 3];
  return { scale: extra?.scale ?? v.yScale, fmt: extra?.fmt ?? null, lim: extra?.lim ?? null };
}

/** How `axis` is laid out. An unset Y2 scale is linear (Y2 does not inherit Y1's scale); an extra axis without
 *  its own scale takes Y1's. */
export function scrollKind(v: ScrollView, axis: ScrollAxisName): ScrollKind {
  const { scale, fmt } = axisOf(v, axis);
  if (scale !== "linear") return scale;
  return fmt?.prob === "percent" ? "probPct" : fmt?.prob === "fraction" ? "prob" : "linear";
}

/** The window `axis` is zoomed to (null = auto: nothing to scroll). */
export const scrollLim = (v: ScrollView, axis: ScrollAxisName): HalfLim | null => axisOf(v, axis).lim;

/** What each axis can draw, keyed as `dataExtents` reads them: x, y, y2, y3 ... */
export function drawableRules(v: ScrollView, axes: readonly ScrollAxisName[]): Record<string, Drawable> {
  const out: Record<string, Drawable> = {};
  for (const a of axes) {
    const k = scrollKind(v, a);
    out[a] = k === "log" || k === "reciprocal" ? true : k === "prob" ? "fraction" : k === "probPct" ? "percent" : undefined;
  }
  return out;
}

/** The extra axes (Y3...) at least one visible curve is drawn on, in axis order. */
export function extraAxesInUse(v: ScrollView, curves: readonly number[]): ScrollAxisName[] {
  const used = new Set(curves.map((c) => v.yAxisOf[c]).filter((n): n is number => n !== undefined && n >= 3));
  return [...used].sort((a, b) => a - b).filter((n) => n - 3 < v.yAxes.length).map((n) => `y${n}` as ScrollAxisName);
}
