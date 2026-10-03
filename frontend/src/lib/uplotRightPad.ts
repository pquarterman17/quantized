// Room for the x tick labels. Labels are monospace (0.6 em per character) and
// uPlot hands back the strings it last drew in `axis._values`, so both sizes
// below follow what is actually on screen:
//
// - the right padding: uPlot's automatic one is a fixed 25 px (half its
//   default y-axis size), so a wide right-most label ("20,000" at a large tick
//   font) was clipped at the canvas edge;
// - the tick spacing: uPlot's default 50 px between x ticks let "-12,500"
//   labels touch, and zooming in ("1.00005") made them overlap.

import type uPlot from "uplot";

/** Width (px) of the widest x tick label uPlot drew last pass, at font `px`. */
function widest(u: uPlot, px: number): number {
  let n = 0;
  for (const v of (u.axes[0] as { _values?: (string | null)[] | null })._values ?? []) n = Math.max(n, v?.length ?? 0);
  return Math.ceil(n * px * 0.6);
}

/** Right padding (CSS px) that holds half the widest x tick label past the
 *  frame: never below uPlot's own 25, and 0 beside a right y axis, whose
 *  gutter already holds it. */
export const xLabelRightPad =
  (px: number): uPlot.PaddingSide =>
  (u, _side, sides) =>
    sides[1] ? 0 : Math.max(25, widest(u, px) / 2 + 4);

/** Minimum px between x ticks: the widest label plus two characters, never
 *  below uPlot's own 50. */
export const xTickSpace = (px: number) => (u: uPlot): number => Math.max(50, widest(u, px) + Math.ceil(px * 1.2));
