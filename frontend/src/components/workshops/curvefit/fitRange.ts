// Curve Fit's fit range (UX audit 8 #5, lane UX8-D) -- the pure rules.
//
// Lorentzian over a whole 100-1800 cm⁻¹ Raman spectrum fitted one broad hump
// across three peaks; Prism defaults to the visible range and Fityk always
// shows a draggable range. So the fit range defaults to the plot's VISIBLE X
// range once the user has zoomed in, and a single-peak model offers a drag on
// the plot when nothing is zoomed. Both land in the panel's analysis
// selection (`range`), the one place the fit reads its rows from.

import { resolveHalfLim, type HalfLim } from "../../../lib/axisLim";

export interface XRange {
  lo: number;
  hi: number;
}

/** Finite [min, max] of `x`, or null without two distinct finite values. */
export function finiteExtent(x: readonly (number | null | undefined)[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of x) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo < hi ? [lo, hi] : null;
}

/** The visible X range when the plot is zoomed IN on data whose X spans
 *  `extent` (`finiteExtent`; a set X limit that leaves part of the data
 *  outside), or null: not zoomed, zoomed out past the data, or a limit that
 *  leaves no data inside. An open side of a half-set limit is the data's own
 *  end, as the plot draws it. */
export function zoomedRange(xLim: HalfLim | null, extent: readonly [number, number] | null): XRange | null {
  if (!xLim || (xLim[0] === null && xLim[1] === null) || !extent) return null;
  const view = resolveHalfLim(xLim, extent).range;
  if (!view) return null;
  const lo = Math.max(Math.min(view[0], view[1]), extent[0]);
  const hi = Math.min(Math.max(view[0], view[1]), extent[1]);
  if (!(lo < hi)) return null;
  return lo > extent[0] || hi < extent[1] ? { lo, hi } : null;
}

/** A single-peak model: Curve Fit's "Peak" / Origin "Peak Functions"
 *  registry categories (Gaussian, Lorentzian, Voigt, LogNormal, ...). */
export const isSinglePeakModel = (category: string | undefined): boolean =>
  category === "Peak" || category === "Peak Functions";

/** Same range (both absent, or equal ends). */
export const sameRange = (a: XRange | null | undefined, b: XRange | null | undefined): boolean =>
  (!a && !b) || (!!a && !!b && a.lo === b.lo && a.hi === b.hi);
