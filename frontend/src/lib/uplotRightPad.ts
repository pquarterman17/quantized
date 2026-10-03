// Room for the x tick labels (monospace digits, 0.6 em per character):
//
// - the right padding: uPlot's automatic one is a fixed 25 px (half its
//   default y-axis size), so a wide right-most label ("20,000" at a large tick
//   font) was clipped at the canvas edge. It is a NUMBER fixed at build time,
//   sized for a 7-character label ("-20,000", "1.00005"): a padding FUNCTION
//   makes uPlot re-converge its layout, and measured on a 7-file VSM overlay
//   (block rows, non-monotonic x) every series but the last then drew as a
//   vertical line at the right edge.
// - the tick spacing: uPlot's default 50 px between x ticks let "-12,500"
//   labels touch, and zooming in ("1.00005") made them overlap. uPlot hands
//   back the strings it last drew in `axis._values`, so the spacing follows
//   what is actually on screen.

import type uPlot from "uplot";

/** Right padding (CSS px) holding half a 7-character x tick label past the
 *  frame at tick font `px`, never below uPlot's own 25. */
export const xLabelRightPad = (px: number): number => Math.max(25, Math.ceil(px * 7 * 0.3) + 4);

/** Minimum px between x ticks: the widest label drawn last pass plus two
 *  characters, never below uPlot's own 50. */
export const xTickSpace =
  (px: number) =>
  (u: uPlot): number => {
    let n = 0;
    for (const v of (u.axes[0] as { _values?: (string | null)[] | null })._values ?? []) n = Math.max(n, v?.length ?? 0);
    return Math.max(50, Math.ceil((n + 2) * px * 0.6));
  };
