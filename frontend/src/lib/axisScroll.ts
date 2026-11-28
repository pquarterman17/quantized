// Axis scroller (Origin's axis scrollbar; gap plan item 22): pan the zoomed
// window of an axis across the data with a slider. Pure model: the data's
// extent on each axis and the slider <-> window mapping.
//
// Rows are read through the row-state model (`analysisData`: exclusion and the
// data filter pruned), so the scroller spans what the plot draws, not rows
// hidden by a mask. The window keeps its WIDTH; only its position moves, and
// it is clamped to the extent so it can never scroll off the data.

import { inProbDomain, probBackward, probForward, type ProbUnit } from "./axisScales";
import { effectiveChannels } from "./plotdata";
import { curveX } from "./perSeriesX";
import { analysisData } from "./rowstate";
import type { Dataset } from "./types";

export type Extent = readonly [number, number];
/** How an axis is laid out, so the slider moves in ITS coordinates. */
export type ScrollKind = "linear" | "log" | "reciprocal" | "prob" | "probPct";
/** Which Y axis' curves the Y extent spans: the primary, the secondary, or an axis NUMBER 3..8 (Y3 ...). */
export type YSide = "primary" | "y2" | number;
/** What an axis can draw: `true` = only values above zero (log, reciprocal); a unit = only inside that probability
 *  domain (0, 1) or (0, 100); unset = anything finite. */
export type Drawable = boolean | ProbUnit | undefined;

/** The X extent and the Y extent of the focused graph's visible curves (`null` for an axis
 *  with no finite value). X spans every visible curve, as the X axis is shared; Y spans the
 *  curves drawn on `side` (default the primary axis). `positive` marks the axes that cannot
 *  draw a value at or below zero (log AND reciprocal): only positive values count there, so
 *  the extent (and every window scrolled within it) stays above zero. */
export function dataExtents(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
  hidden: readonly number[],
  y2: readonly number[],
  positive: Record<string, Drawable> = {},
  side: YSide = "primary",
  axisOf: Readonly<Record<number, number>> = {},
): { x: Extent | null; y: Extent | null } {
  const view = analysisData(ds);
  if (!view) return { x: null, y: null };
  const chans = effectiveChannels(ds.data, yKeys, xKey, ds.channelRoles, seriesOrder).filter((c) => !hidden.includes(c));
  const own = curveX(ds, xKey);
  const box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
  // A point counts only when it can be drawn: finite on both axes, and above zero on one that needs it.
  const drawable = (axis: string, v: number | undefined): v is number => {
    const rule = positive[axis];
    return typeof v === "number" && Number.isFinite(v) && (typeof rule === "string" ? inProbDomain(v, rule) : !(rule && v <= 0));
  };
  const target = side === "primary" ? 1 : side === "y2" ? 2 : side;
  const take = (axis: "x" | "y", v: number) => {
    box[axis] = [Math.min(box[axis][0], v), Math.max(box[axis][1], v)];
  };
  for (const c of chans) {
    const xc = own[c] === undefined ? xKey : own[c];
    const ownAxis = axisOf[c] ?? (y2.includes(c) ? 2 : 1); // a channel on Y3+ is never also Y2 (the canvas' tie-break)
    const yRule = ownAxis === 1 ? "y" : `y${ownAxis}`;
    for (let r = 0; r < view.time.length; r++) {
      const y = view.values[r]?.[c];
      const x = xc == null ? view.time[r] : view.values[r][xc];
      if (!drawable(yRule, y) || !drawable("x", x)) continue;
      take("x", x);
      if (ownAxis === target) take("y", y);
    }
  }
  const ok = (b: number[]): Extent | null => (b[0] <= b[1] ? [b[0], b[1]] : null);
  return { x: ok(box.x), y: ok(box.y) };
}

// A log axis scrolls in log10 space, a reciprocal one in 1/x space and a probability one in probit (normal
// quantile) space, as Origin does: the slider is linear in that space, so a notch is the same distance in the
// axis' own coordinates anywhere, and the window keeps its width there. 1/x runs backwards, so the slider is
// flipped to keep "right" meaning higher X, as the axis draws it. A limit or extent the space cannot hold (at or
// below zero for log and 1/x, outside (0, 1) or (0, 100) for a probability axis) leaves the window alone.
const prob = (unit: ProbUnit) => ({ to: (v: number) => probForward(v, unit), back: (z: number) => probBackward(z, unit), flip: false });
const SPACE = {
  log: { to: Math.log10, back: (v: number) => 10 ** v, flip: false },
  reciprocal: { to: (v: number) => 1 / v, back: (v: number) => 1 / v, flip: true },
  prob: prob("fraction"),
  probPct: prob("percent"),
} as const;
const toSpace = (kind: Exclude<ScrollKind, "linear">, v: Extent): Extent | null => {
  if (kind !== "prob" && kind !== "probPct" && !(v[0] > 0 && v[1] > 0)) return null;
  const out: Extent = [SPACE[kind].to(v[0]), SPACE[kind].to(v[1])];
  return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : null;
};
const ascending = (e: Extent): Extent => (e[0] <= e[1] ? e : [e[1], e[0]]);

/** Slider position 0..1 of window `lim` within `extent`, or null when the window
 *  already covers the extent (nothing to scroll). Measured in the axis' own space. */
export function scrollFraction(lim: Extent, extent: Extent, kind: ScrollKind = "linear"): number | null {
  if (kind !== "linear") {
    const [l, e] = [toSpace(kind, lim), toSpace(kind, extent)];
    const t = l && e ? scrollFraction(l, ascending(e)) : null;
    return t !== null && SPACE[kind].flip ? 1 - t : t;
  }
  const room = extent[1] - extent[0] - Math.abs(lim[1] - lim[0]);
  if (!(room > 0)) return null;
  return Math.min(1, Math.max(0, (Math.min(lim[0], lim[1]) - extent[0]) / room));
}

/** The window of `lim`'s width at slider position `t` within `extent`; a reversed
 *  axis (min > max) stays reversed. On a log or reciprocal axis the width and position
 *  are in that space, and a limit or extent at or below zero leaves `lim` unchanged. */
export function scrolledWindow(lim: Extent, extent: Extent, t: number, kind: ScrollKind = "linear"): [number, number] {
  const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  if (kind !== "linear") {
    const [l, e] = [toSpace(kind, lim), toSpace(kind, extent)];
    if (!l || !e) return [lim[0], lim[1]];
    const [a, b] = scrolledWindow(l, ascending(e), SPACE[kind].flip ? 1 - at : at);
    return [SPACE[kind].back(a), SPACE[kind].back(b)];
  }
  const width = Math.abs(lim[1] - lim[0]);
  const lo = extent[0] + at * Math.max(0, extent[1] - extent[0] - width);
  return lim[0] > lim[1] ? [lo + width, lo] : [lo, lo + width];
}
