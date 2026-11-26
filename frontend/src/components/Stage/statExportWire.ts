// The small request fragments the Stat Stage's export requests share (colour
// levels, the palette, the error-bar footnote), split out of `statStageExport.ts`
// (its 500-line ceiling) with their behaviour unchanged.

import { resolvedPalette } from "../../lib/plotEncodingWire";

/** P1.4 Color-by on the wire: each group's colour LEVEL (`lib/statColor`,
 *  aligned with the request's groups) and the palette the canvas resolves, as
 *  hex. Without a colour factor only the palette rides, so the export colours
 *  by position / series as the canvas does. No title either: the canvas draws
 *  none (review finding: the export added "Value by Sample"). */
export function colorWire(levels: readonly (number | null)[] | null | undefined): {
  color_levels?: (number | null)[];
  palette?: string[];
} {
  return { ...(levels ? levelsWire(levels) : {}), ...paletteWire() };
}

/** A facet panel's half: its levels only (the palette rides the request). */
export function levelsWire(levels: readonly (number | null)[] | null | undefined): { color_levels?: (number | null)[] } {
  return levels ? { color_levels: [...levels] } : {};
}

/** The request's palette — ALWAYS, so a group or series without a colour
 *  level is drawn in the canvas' `seriesColor(i)`, not matplotlib's default
 *  (review finding: the bar export was blue under the screen's purple). */
export function paletteWire(): { palette?: string[] } {
  const palette = resolvedPalette();
  return palette ? { palette } : {};
}

/** `error_note` on the wire only when there is one, so a request without
 *  error bars stays the one it always was. */
export function noteWire(note: string | null | undefined): { error_note?: string } {
  return note ? { error_note: note } : {};
}
