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
// - the tick spacing (audit 6 P3) of the linear, numeric, automatically
//   spaced MAIN axes (X, Y, Y2, Y3+): matplotlib's AutoLocator, so the canvas
//   and a matplotlib export of a comparable size pick the same increment.
//   uPlot's 30 px default put ~20 majors on a Y axis (0.0005 apart on an MPMS
//   moment axis) where Origin and matplotlib draw 5-9. `autoTickStep` ports
//   MaxNLocator(nbins="auto", steps 1-2-2.5-5-10): bins = clip(floor(length /
//   (font * per_tick)), 1, 9), per_tick 2 on Y and 3 on X, the smallest nice
//   step >= span / bins, backing off while fewer than `gaps` + 1 ticks would show
//   (matplotlib's 2; the screen's X asks for 3, room allowing). The canvas
//   measures length and font in CSS px, matplotlib in pt. Pinned against
//   matplotlib by `tests/fixtures/wire/tick_density.json`. NOT covered: inset
//   layers (`lib/graphLayers`), Y breaks (`lib/axisBreaks`) and date X (50 px
//   floor) keep their own rules. The drawn increments reach an export only as
//   a hint it takes when they fit (`lib/liveTickSteps.ts`, `calc.tick_hint`).
//   On X the spacing never drops below the widest label drawn last pass plus
//   two characters (uPlot hands back the strings in `axis._values`), so
//   "-12,500" labels never touch; that floor can make long-label X sparser
//   than matplotlib's.

import type uPlot from "uplot";

import { pow10 } from "./ticks";

/** Right padding (CSS px) holding half a 7-character x tick label past the
 *  frame at tick font `px`, never below uPlot's own 25. */
export const xLabelRightPad = (px: number): number => Math.max(25, Math.ceil(px * 7 * 0.3) + 4);

/** matplotlib's automatic major increment for [lo, hi] on an axis `length`
 *  long at tick font `font` (same units), `per` font sizes per tick. */
export function autoTickStep(lo: number, hi: number, length: number, font: number, per: number, gaps = 1): number {
  const raw = (hi - lo) / Math.min(9, Math.max(1, Math.floor(length / (font * per))));
  const mag = pow10(Math.floor(Math.log10(raw)));
  // raw = span / bins lies in [mag, 10 mag), so some step always holds it.
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((k) => k * mag);
  let i = steps.findIndex((s) => s >= raw);
  while (i > 0 && Math.floor(hi / steps[i]) - Math.ceil(lo / steps[i]) < gaps) i--;
  return steps[i];
}

/** The px between ticks that make uPlot pick exactly `autoTickStep` (its
 *  1-2-2.5-5 table holds the same steps); uPlot's 30 on a degenerate range. */
function autoSpace(lo: number, hi: number, dim: number, px: number, per: number, gaps?: number): number {
  return hi > lo && dim > 0 ? ((dim * autoTickStep(lo, hi, dim, px, per, gaps)) / (hi - lo)) * 0.999999 : 30;
}

/** uPlot `space` for a linear numeric Y axis (Y, Y2, Y3+): two font sizes per tick. */
export const yTickSpace =
  (px: number) =>
  (_u: uPlot, _i: number, lo: number, hi: number, dim: number): number =>
    autoSpace(lo, hi, dim, px, 2);

/** uPlot `space` for X: three font sizes per tick and at least three ticks
 *  on a numeric axis (`auto`), uPlot's own 50 on a date one, never closer
 *  than the labels allow. */
export const xTickSpace =
  (px: number, auto: boolean) =>
  (u: uPlot, _i: number, lo: number, hi: number, dim: number): number => {
    let n = 0;
    for (const v of (u.axes[0] as { _values?: (string | null)[] | null })._values ?? []) n = Math.max(n, v?.length ?? 0);
    return Math.max(Math.ceil((n + 2) * px * 0.6), auto ? autoSpace(lo, hi, dim, px, 3, 2) : 50);
  };
