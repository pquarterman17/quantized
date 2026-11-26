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

/** The X and Y extent of the focused graph's visible, primary-axis curves
 *  (`null` for an axis with no finite value). */
export function dataExtents(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
  hidden: readonly number[],
  y2: readonly number[],
): { x: Extent | null; y: Extent | null } {
  const view = analysisData(ds);
  if (!view) return { x: null, y: null };
  const chans = effectiveChannels(ds.data, yKeys, xKey, ds.channelRoles, seriesOrder).filter((c) => !hidden.includes(c) && !y2.includes(c));
  const own = curveX(ds, xKey);
  const box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
  const take = (axis: "x" | "y", v: number | undefined) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    box[axis] = [Math.min(box[axis][0], v), Math.max(box[axis][1], v)];
  };
  for (const c of chans) {
    const xc = own[c] === undefined ? xKey : own[c];
    for (let r = 0; r < view.time.length; r++) {
      const y = view.values[r]?.[c];
      if (typeof y !== "number" || !Number.isFinite(y)) continue;
      take("y", y);
      take("x", xc == null ? view.time[r] : view.values[r][xc]);
    }
  }
  const ok = (b: number[]): Extent | null => (b[0] <= b[1] ? [b[0], b[1]] : null);
  return { x: ok(box.x), y: ok(box.y) };
}

/** Slider position 0..1 of window `lim` within `extent`, or null when the window
 *  already covers the extent (nothing to scroll). */
export function scrollFraction(lim: Extent, extent: Extent): number | null {
  const room = extent[1] - extent[0] - Math.abs(lim[1] - lim[0]);
  if (!(room > 0)) return null;
  return Math.min(1, Math.max(0, (Math.min(lim[0], lim[1]) - extent[0]) / room));
}

/** The window of `lim`'s width at slider position `t` within `extent`; a reversed
 *  axis (min > max) stays reversed. */
export function scrolledWindow(lim: Extent, extent: Extent, t: number): [number, number] {
  const width = Math.abs(lim[1] - lim[0]);
  const lo = extent[0] + Math.min(1, Math.max(0, t)) * Math.max(0, extent[1] - extent[0] - width);
  return lim[0] > lim[1] ? [lo + width, lo] : [lo, lo + width];
}
