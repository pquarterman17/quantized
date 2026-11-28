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

/** A text symbol: 1-3 characters (plan item 24); anything else draws no text, as the export. */
export const validText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && [...v].length <= 3;

/** A text symbol's font size, pt. */
export const validTextSize = (v: unknown): v is number => typeof v === "number" && v >= 4 && v <= 72;

/** The per-point text source a graph template can carry (plan item 24): letters, row numbers, or a text column by
 *  NAME. A worksheet column INDEX is bound to one sheet's layout, so it is not portable and is not kept (as size-by). */
export const portableTextFrom = (v: unknown): "letters" | "rows" | { name: string } | undefined =>
  v === "letters" || v === "rows" ? v : typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string" && (v as { name: string }).name !== "" ? { name: (v as { name: string }).name } : undefined;

/** `style` without an invalid `markerEvery` / `markerAlpha` / `markerText`. */
export function cleanSymbols<S extends SeriesStyle | null | undefined>(style: S): S {
  if (!style) return style;
  const out = { ...style };
  if (!validEvery(out.markerEvery)) delete out.markerEvery;
  if (!validAlpha(out.markerAlpha)) delete out.markerAlpha;
  if (!validText(out.markerText)) delete out.markerText;
  if (!validTextSize(out.markerTextSize)) delete out.markerTextSize;
  return out;
}

/** Every channel's style through `cleanSymbols`. */
export const cleanSymbolStyles = (styles: Record<number, SeriesStyle>): Record<number, SeriesStyle> =>
  Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, cleanSymbols(v)]));
