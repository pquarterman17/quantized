// Where the canvas draws an axis' divide-by factor ("×10³", the Axis dialog's
// "Divide by") -- split out of `lib/axisExtras.ts`, which draws it, so the
// placement rule is one small pure module (loaded on demand with it).
//
// The factor sits OUTSIDE the frame, where the export's matplotlib offset
// text sits (`calc/axis_extras.py`'s `_DividedFormatter.get_offset`): above
// the top end of a Y / Y2 axis, and below the tick labels at the right end of
// the X axis. It used to be drawn inside the plot's top-left corner, small,
// where the legend's default spot covered it (figures live check). It is set
// in the axis' own tick-label font and size, and the plot reserves a band
// above the frame for it (`divideTopPadding`), which is what clipped it when
// it first sat there.

import type uPlot from "uplot";

/** uPlot's Side enum as plain numbers: 0 top, 1 right, 2 bottom, 3 left. */
export type AxisSide = 0 | 1 | 2 | 3;

/** Gap between the factor and the frame (or the tick labels), CSS px. */
const GAP = 4;
/** uPlot's default tick length + label gap below the X axis line, CSS px. */
const X_LABEL_OFFSET = 15;

/** The canvas font for the factor: the axis' own tick-label font. After
 *  uPlot's init `axis.font` is `[font, px]` already scaled to device pixels;
 *  before it, a CSS string ("12px Mono") that is scaled here. */
export function divideFont(font: uPlot.Axis["font"] | readonly unknown[] | undefined, pr: number): { font: string; px: number } {
  if (Array.isArray(font) && typeof font[0] === "string") {
    const px = typeof font[1] === "number" ? font[1] : parseFloat(/([\d.]+)px/.exec(font[0])?.[1] ?? "12") * pr;
    return { font: font[0], px };
  }
  if (typeof font === "string") {
    const css = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? "12");
    return { font: font.replace(/([\d.]+)px/, `${css * pr}px`), px: css * pr };
  }
  return { font: `${12 * pr}px sans-serif`, px: 12 * pr };
}

/** Where the factor goes, in canvas (device) px, for an axis on `side` of
 *  the plotting box `bbox`, with a `px`-tall font. */
export function divideLabelSpot(
  side: AxisSide,
  bbox: { left: number; top: number; width: number; height: number },
  pr: number,
  px: number,
  lift = 0,
): { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline } {
  const { left, top, width, height } = bbox;
  // `lift`: a Y / Y2 factor rides above a shown top X axis (its device-px size) instead of under it.
  if (side === 3) return { x: left, y: top - lift - GAP * pr, align: "left", baseline: "bottom" };
  if (side === 1) return { x: left + width, y: top - lift - GAP * pr, align: "right", baseline: "bottom" };
  if (side === 2) return { x: left + width, y: top + height + X_LABEL_OFFSET * pr + px + GAP * pr, align: "right", baseline: "top" };
  return { x: left + width, y: top - X_LABEL_OFFSET * pr - px - GAP * pr, align: "right", baseline: "bottom" };
}

/** Device px a Y / Y2 factor must rise to clear the top X axis (axis side 0)
 *  the plot draws, 0 without one: both would otherwise sit in the same band. */
export function topAxisLift(u: uPlot, pr: number): number {
  let lift = 0;
  for (const axis of u.axes) {
    if ((axis?.side as number | undefined) !== 0 || axis.show === false || (axis as { _show?: boolean })._show === false) continue;
    const size = (axis as { _size?: number })._size ?? (typeof axis.size === "number" ? axis.size : 0);
    lift = Math.max(lift, size * pr);
  }
  return lift;
}

/** The top padding (CSS px) a plot needs so a factor above a Y / Y2 axis is
 *  not clipped: its font height plus a gap each side. */
export function divideTopPadding(cssFont: string | undefined): number {
  const css = parseFloat(/([\d.]+)px/.exec(cssFont ?? "")?.[1] ?? "12");
  return Math.ceil(css * 1.25 + 2 * GAP);
}

// `reserveDivideBand` lives in ./axisDivideReserve.ts: only the on-demand lib/axisExtras.ts applies it.
export * from "./axisDivideReserve";
