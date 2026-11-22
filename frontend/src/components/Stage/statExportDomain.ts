// The canvas's y-domain and the comparison marks as the export request carries
// them. Split out of `statStageExport.ts` (on the 500-line ceiling).

import type { ComparisonMarks } from "../../lib/statComparisons";
import type { ResolvedStatMarks } from "../../lib/statMarks";
import { boxValueDomain, comparisonExtent, drawMarks, stripValueDomain } from "./statDrawMarks";
import type { StatDrawData } from "./statRender";

/** Review finding 2: the canvas's box/strip value domain (`statDrawMarks.
 *  boxValueDomain`/`stripValueDomain`) always spans every raw datum
 *  (fliers, hidden points) so toggling a mark never rescales the plot --
 *  but matplotlib autoscales to whatever it actually drew, which is a
 *  NARROWER range whenever a mark is hidden (`points: "none"`, say). Rather
 *  than change either side's domain rule, send the canvas's own range as an
 *  explicit y-limit so the export matches it exactly (`ax.set_ylim`, see
 *  `figure_statplots.render_statplot_figure`'s `y_domain`). Violin has no
 *  such divergence (its domain is the KDE curve's own extent, never the
 *  points') so this is box/strip only. */
export function canvasYDomain(draw: StatDrawData | null, m: ResolvedStatMarks | null): [number, number] | null {
  if (!draw) return null;
  if (draw.mode === "box") return boxValueDomain(draw.boxes, m ?? drawMarks(draw), comparisonExtent(draw));
  if (draw.mode === "strip") return stripValueDomain(draw);
  return null;
}

/** `{ comparisons }` for the request when `draw` carries brackets or letters
 *  (the laid-out geometry itself, posted verbatim: screen and figure share
 *  ONE layout), else nothing. */
export function comparisonWire(draw: StatDrawData | null): { comparisons?: ComparisonMarks } {
  const c = draw && draw.mode !== "qq" && draw.mode !== "histogram" ? draw.comparisons : null;
  return c && (c.brackets.length || c.letters.length) ? { comparisons: c } : {};
}
