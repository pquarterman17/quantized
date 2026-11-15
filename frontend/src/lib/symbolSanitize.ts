// Validation of the gap audit 4 G10 symbol values read from untrusted input
// (a `.dwk`, a graph template, a pinned publication style): review L5. The
// Inspector already validates what it writes; a file is not, and an invalid
// value made the canvas and the export disagree (`markerEvery: 2.5` drew every
// 5th point on screen and every point in the PDF, whose `calc.figure_symbols`
// rejects it). Both sides accept exactly what these accept.

import type { SeriesStyle } from "./seriesStyleTypes";

/** "Symbol every N points": an integer 2..100000 (1 = every point = unset). */
export const validEvery = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 1 && (v as number) <= 1e5;

/** A fill opacity: a number 0..1. */
export const validAlpha = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;

/** `style` without an invalid `markerEvery` / `markerAlpha`. */
export function cleanSymbols<S extends SeriesStyle | null | undefined>(style: S): S {
  if (!style) return style;
  const out = { ...style };
  if (!validEvery(out.markerEvery)) delete out.markerEvery;
  if (!validAlpha(out.markerAlpha)) delete out.markerAlpha;
  return out;
}

/** Every channel's style through `cleanSymbols`. */
export const cleanSymbolStyles = (styles: Record<number, SeriesStyle>): Record<number, SeriesStyle> =>
  Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, cleanSymbols(v)]));
