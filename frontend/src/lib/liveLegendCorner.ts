// The Stage export's "auto" legend lands where the screen put it (plot audit
// round 4). An auto legend with up to eight series sits inside the frame in
// the corner `lib/legendAutoPlace` picked (the stage's `data-lc`); the export
// sent `loc: "auto"`, which matplotlib resolves as "best" over its own nine
// candidate spots. Measured on an eight-species SIMS profile: the screen drew
// the legend bottom right, the PDF centre left. The export of the focused
// Stage now names the corner the screen shows. Past eight series both sides
// already agree on "outside right", so that case is left alone, as is every
// fixed or dragged position. Imported only by the lazily loaded export path.

import type { FigureSpec } from "./api/figures";
import { legendPosToLoc } from "./figureOverrides";

const CORNERS = ["ne", "nw", "se", "sw"] as const;
type Corner = (typeof CORNERS)[number];

/** `spec` with an "auto" legend pinned to the corner the focused Stage draws
 *  its in-frame auto legend in; `spec` itself when there is none to read. */
export function withLiveLegendCorner(spec: FigureSpec, root: ParentNode = document): FigureSpec {
  const legend = spec.overrides?.legend;
  if (!legend || legend.loc !== "auto") return spec;
  const stage = root.querySelector<HTMLElement>(".qzk-stage");
  const lc = stage?.dataset.lc;
  if (!stage?.querySelector(":scope > .qzk-legend.auto") || !CORNERS.includes(lc as Corner)) return spec;
  return { ...spec, overrides: { ...spec.overrides, legend: { ...legend, loc: legendPosToLoc(lc as Corner) } } };
}
