// Room for the x tick labels (monospace digits, 0.6 em per character), and the
// automatic tick density of every linear axis:
//
// - the right padding: uPlot's automatic one is a fixed 25 px (half its
//   default y-axis size), so a wide right-most label ("20,000" at a large tick
//   font) was clipped at the canvas edge. It is a NUMBER fixed at build time,
//   sized for a 7-character label ("-20,000", "1.00005"): a padding FUNCTION
//   makes uPlot re-converge its layout, and measured on a 7-file VSM overlay
//   (block rows, non-monotonic x) every series but the last then drew as a
//   vertical line at the right edge.
// - the tick spacing (audit 6 P3): ONE rule for the canvas and every export,
//   matplotlib's AutoLocator. uPlot's 30 px default put ~20 majors on a Y axis
//   (0.0005 apart on an MPMS moment axis) where Origin and matplotlib draw
//   5-9. `autoTickStep` ports MaxNLocator(nbins="auto", steps 1-2-2.5-5-10):
//   bins = clip(floor(length / (font * per_tick)), 1, 9), per_tick 2 on Y and
//   3 on X, the smallest nice step >= span / bins, backing off while fewer
//   than two ticks would show. The canvas measures length and font in CSS px,
//   matplotlib in pt; the ratio is the same. The export sends NO automatic
//   step: matplotlib's own locator applies the rule at the export's size, so
//   Export figure, Copy figure and Publication preview agree for one graph
//   and size, and the screen agrees with them at a comparable size. Pinned
//   against matplotlib by `tests/fixtures/wire/tick_density.json`.
//   On X the spacing never drops below the widest label drawn last pass plus
//   two characters (uPlot hands back the strings in `axis._values`), so
//   "-12,500" labels never touch.

import type uPlot from "uplot";

import { pow10 } from "./ticks";

/** Right padding (CSS px) holding half a 7-character x tick label past the
 *  frame at tick font `px`, never below uPlot's own 25. */
export const xLabelRightPad = (px: number): number => Math.max(25, Math.ceil(px * 7 * 0.3) + 4);

/** matplotlib's automatic major increment for [lo, hi] on an axis `length`
 *  long at tick font `font` (same units), `per` font sizes per tick. */
export function autoTickStep(lo: number, hi: number, length: number, font: number, per: number): number {
  const span = hi - lo;
  const bins = Math.min(9, Math.max(1, Math.floor(length / (font * per))));
  const mag = pow10(Math.floor(Math.log10(span / bins)));
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((k) => Number((k * mag).toPrecision(12)));
  let i = steps.findIndex((s) => s >= span / bins);
  if (i < 0) i = 8;
  while (i > 0 && Math.floor(hi / steps[i]) - Math.ceil(lo / steps[i]) < 1) i--;
  return steps[i];
}

/** The px between ticks that make uPlot pick exactly `autoTickStep` (its
 *  1-2-2.5-5 table holds the same steps); uPlot's 30 on a degenerate range. */
function autoSpace(lo: number, hi: number, dim: number, px: number, per: number): number {
  return hi > lo && Number.isFinite(hi - lo) && dim > 0 ? ((dim * autoTickStep(lo, hi, dim, px, per)) / (hi - lo)) * 0.999999 : 30;
}

/** uPlot `space` for a linear numeric Y axis (Y, Y2, Y3+): two font sizes per tick. */
export const yTickSpace =
  (px: number) =>
  (_u: uPlot, _i: number, lo: number, hi: number, dim: number): number =>
    autoSpace(lo, hi, dim, px, 2);

/** uPlot `space` for X: three font sizes per tick on a numeric axis (`auto`),
 *  uPlot's own 50 on a date one, never closer than the labels allow. */
export const xTickSpace =
  (px: number, auto: boolean) =>
  (u: uPlot, _i: number, lo: number, hi: number, dim: number): number => {
    let n = 0;
    for (const v of (u.axes[0] as { _values?: (string | null)[] | null })._values ?? []) n = Math.max(n, v?.length ?? 0);
    return Math.max(Math.ceil((n + 2) * px * 0.6), auto ? autoSpace(lo, hi, dim, px, 3) : 50);
  };
