// Axis scroller (Origin's axis scrollbar; gap plan item 22): pan the zoomed
// window of an axis across the data with a slider. Pure model: the data's
// extent on each axis and the slider <-> window mapping.
//
// Rows are read through the row-state model (`analysisData`: exclusion and the
// data filter pruned), so the scroller spans what the plot draws, not rows
// hidden by a mask. The window keeps its WIDTH; only its position moves, and
// it is clamped to the extent so it can never scroll off the data.

import { effectiveChannels } from "./plotdata";
import { curveX } from "./perSeriesX";
import { analysisData } from "./rowstate";
import type { Dataset } from "./types";

export type Extent = readonly [number, number];
/** How an axis is laid out, so the slider moves in ITS coordinates. */
export type ScrollKind = "linear" | "log" | "reciprocal";
/** Which Y axis' curves the Y extent spans. */
export type YSide = "primary" | "y2";

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
  positive: { x?: boolean; y?: boolean; y2?: boolean } = {},
  side: YSide = "primary",
): { x: Extent | null; y: Extent | null } {
  const view = analysisData(ds);
  if (!view) return { x: null, y: null };
  const chans = effectiveChannels(ds.data, yKeys, xKey, ds.channelRoles, seriesOrder).filter((c) => !hidden.includes(c));
  const own = curveX(ds, xKey);
  const box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
  // A point counts only when it can be drawn: finite on both axes, and above zero on one that needs it.
  const drawable = (axis: "x" | "y" | "y2", v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && !(positive[axis] && v <= 0);
  const take = (axis: "x" | "y", v: number) => {
    box[axis] = [Math.min(box[axis][0], v), Math.max(box[axis][1], v)];
  };
  for (const c of chans) {
    const xc = own[c] === undefined ? xKey : own[c];
    const onY2 = y2.includes(c);
    for (let r = 0; r < view.time.length; r++) {
      const y = view.values[r]?.[c];
      const x = xc == null ? view.time[r] : view.values[r][xc];
      if (!drawable(onY2 ? "y2" : "y", y) || !drawable("x", x)) continue;
      take("x", x);
      if (onY2 === (side === "y2")) take("y", y);
    }
  }
  const ok = (b: number[]): Extent | null => (b[0] <= b[1] ? [b[0], b[1]] : null);
  return { x: ok(box.x), y: ok(box.y) };
}

// A log axis scrolls in log10 space and a reciprocal one in 1/x space (as Origin does): the
// slider is linear in that space, so a notch is the same distance in the axis' own coordinates
// anywhere, and the window keeps its width there. 1/x runs backwards, so the slider is flipped
// to keep "right" meaning higher X, as the axis draws it. A non-positive limit or extent has
// no log or reciprocal: the window is left alone.
const SPACE = {
  log: { to: Math.log10, back: (v: number) => 10 ** v, flip: false },
  reciprocal: { to: (v: number) => 1 / v, back: (v: number) => 1 / v, flip: true },
} as const;
const toSpace = (kind: Exclude<ScrollKind, "linear">, v: Extent): Extent | null => (v[0] > 0 && v[1] > 0 ? [SPACE[kind].to(v[0]), SPACE[kind].to(v[1])] : null);
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
