// Validation and reading of the line-polish style values (plan item 17: gap to
// symbol, line in front of / behind the symbols, double line) from untrusted
// input (a `.dwk`, a template, a pinned publication style), and the one rule
// for which series they apply to. Eager and tiny, like `symbolSanitize.ts`; the
// geometry (`lineStyleGeometry.ts`) and the canvas paths (`uplotLineStyle.ts`)
// ride the lazy marks chunk. The export (`calc/figure_line_style.py`) accepts
// exactly what these accept.

import type { SeriesStyle } from "./seriesStyleTypes";

/** Largest gap / separation a style may carry, in points. */
export const MAX_LINE_STYLE_PT = 50;

/** A positive point length up to `MAX_LINE_STYLE_PT` (the shared validation; the export's `_pos` agrees). */
export const validLength = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_LINE_STYLE_PT;

/** The line-polish options of one style, validated; null when it sets none. */
export interface LineStyleSpec {
  /** Gap between the line and each symbol, points (0 = none). */
  gap: number;
  /** Separation of the two strokes of a double line, points (0 = single). */
  sep: number;
  /** Draw the line over the symbols instead of under them. */
  front: boolean;
}

/** Series the options do not apply to: bars, stacks, steps, splines, size / colour maps. */
export const lineStyleApplies = (s: SeriesStyle): boolean =>
  !s.bars && !s.stack && !s.step && !s.connect && s.sizeBy == null && s.colorBy == null;

/** The validated options of `style`, or null (none set, or a series they do not apply to). */
export function lineStyleSpec(style: SeriesStyle | undefined): LineStyleSpec | null {
  if (!style || !lineStyleApplies(style)) return null;
  const gap = validLength(style.symbolGap) ? style.symbolGap : 0;
  const sep = validLength(style.doubleLine) ? style.doubleLine : 0;
  const front = style.lineFront === true;
  return gap || sep || front ? { gap, sep, front } : null;
}

/** `style` without invalid line-polish values (a `.dwk` or template is untrusted input). */
export function cleanLineStyle<S extends SeriesStyle | null | undefined>(style: S): S {
  if (!style) return style;
  const out = { ...style };
  if (!validLength(out.symbolGap)) delete out.symbolGap;
  if (!validLength(out.doubleLine)) delete out.doubleLine;
  if (out.lineFront !== true) delete out.lineFront;
  return out;
}

/** Every channel's style through `cleanLineStyle`. */
export const cleanLineStyles = (styles: Record<number, SeriesStyle>): Record<number, SeriesStyle> =>
  Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, cleanLineStyle(v)]));

