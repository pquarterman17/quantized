// The 2-D map's scale bar: how long it is, what it says and where it sits.
// Pure. The canvas (`components/Stage/mapScaleBarDraw.ts`) and the vector export
// (`src/quantized/calc/map_scalebar.py`, drawn by `figure_map_scalebar.py`) apply
// the same three rules, pinned by `tests/fixtures/wire/map_scalebar.json`:
//  * length: the bar's own, in X data units, else a round number near 20 % of the axis;
//  * label: the user's text, else the length with the axis unit;
//  * placement: a corner of the plot area, inset, the label under the bar and centred on it.
// Placement is in one plane with y growing downward, in screen pixels.
import { fitLabelBox, fmtSig } from "./annotationMeasure";
import type { MapScaleBar, ScaleBarCorner } from "./mapScaleBarOptions";

export * from "./mapScaleBarOptions";

export const BAR_PX = 3; // the bar's thickness
export const MARGIN_PX = 12; // its inset from the frame
const GAP_PX = 4; // between the bar and its label
const TARGET_SHARE = 0.2; // an automatic bar spans about this much of the axis
const STEPS = [1, 2, 5, 10];

/** A round bar length (1, 2 or 5 times a power of ten) nearest to 20 % of `span`;
 *  null for a span that is not a positive finite number. */
export function niceLength(span: number): number | null {
  if (!(span > 0 && span < Infinity)) return null;
  const target = TARGET_SHARE * span;
  const mag = 10 ** Math.floor(Math.log10(target));
  let best = STEPS[0] * mag;
  for (const s of STEPS) if (Math.abs(s * mag - target) < Math.abs(best - target)) best = s * mag;
  return Number(best.toPrecision(12));
}

/** The bar's length and text over an axis `span` wide in `unit`; null when there is no usable length. */
export function resolveScaleBar(
  bar: Pick<MapScaleBar, "length" | "label">, span: number, unit = "",
): { length: number; text: string } | null {
  const length = bar.length || niceLength(span);
  if (!length) return null;
  return { length, text: bar.label || fmtSig(length) + (unit ? ` ${unit}` : "") };
}

/** Where the bar (`x0`..`x1` at height `y`, the centre of its line) and its label (top-left corner)
 *  go in a `plotW` x `plotH` frame, for a bar `barPx` long and a `textW` x `textH` label. */
export function scaleBarLayout(
  corner: ScaleBarCorner, plotW: number, plotH: number, barPx: number, textW: number, textH: number,
): { x0: number; x1: number; y: number; labelLeft: number; labelTop: number } {
  const x0 = corner.endsWith("l") ? MARGIN_PX : plotW - MARGIN_PX - barPx;
  const y = corner.startsWith("t") ? MARGIN_PX : plotH - MARGIN_PX - textH - GAP_PX - BAR_PX / 2;
  const [labelLeft, labelTop] = fitLabelBox(x0 + barPx / 2 - textW / 2, y + BAR_PX / 2 + GAP_PX, textW, textH, [0, 0, plotW, plotH]);
  return { x0, x1: x0 + barPx, y, labelLeft, labelTop };
}
