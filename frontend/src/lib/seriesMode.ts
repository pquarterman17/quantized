// The per-series display MODE vocabulary (F2.3b), moved verbatim out of
// components/workshops/figurebuilder/canonicalSeries.ts (which re-exports it)
// so lib modules -- the figures-audit #8 plot-type gallery -- can share it.
// See canonicalSeries.ts's module doc for the vocabulary's rationale.

import type { SeriesStyle, StepMode } from "./types";

export type SeriesMode = "line" | "scatter" | "lineSymbol" | "step";

export const SERIES_MODE_OPTIONS: { value: SeriesMode; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "scatter", label: "Scatter" },
  { value: "lineSymbol", label: "Line + Symbol" },
  { value: "step", label: "Step" },
];

export const STEP_ALIGN_OPTIONS: { value: StepMode; label: string }[] = [
  { value: "pre", label: "Pre" },
  { value: "post", label: "Post" },
  { value: "mid", label: "Mid" },
];

/** The mode a style currently reads as. Mirrors `lib/plotspec.ts`'s
 *  `markSeriesStyle` mapping in reverse: `step` wins (it implies a connected
 *  line with its own alignment), then a zero width (the Stage's established
 *  "no line, markers only" sentinel -- see `SeriesStyleCard.tsx`'s `setTrace`),
 *  then a bare marker overlay on a connected line, else a plain line. */
export function seriesModeOf(style: SeriesStyle): SeriesMode {
  if (style.step) return "step";
  if (style.width === 0) return "scatter";
  if (style.marker) return "lineSymbol";
  return "line";
}

/** The style patch a mode change commits. Explicit `undefined` clears a field
 *  a PREVIOUS mode set (e.g. leaving "scatter" must drop its `width: 0`
 *  sentinel, not leave a zero-width "line") -- the same one-sided-memory
 *  tradeoff `SeriesStyleCard.tsx`'s `setTrace` already accepts: a custom
 *  width chosen before switching to "scatter" is not restored afterwards. */
export function seriesModePatch(mode: SeriesMode, style: SeriesStyle): Partial<SeriesStyle> {
  const keptWidth = style.width === 0 ? undefined : style.width;
  switch (mode) {
    case "scatter":
      return { width: 0, marker: true, step: undefined };
    case "step":
      return { step: style.step ?? "post", width: keptWidth };
    case "lineSymbol":
      return { marker: true, step: undefined, width: keptWidth };
    case "line":
    default:
      return { marker: false, step: undefined, width: keptWidth };
  }
}
