// Pure per-series canonical-draft helpers (F2.3b): derive/patch a series'
// display MODE from its SeriesStyle fields, and summarize its error-bar
// DESIGNATION for read-only display. No React/store import -- unit-testable
// standalone, same shape as canonicalOverrides.ts.
//
// Reuses the SAME width/marker/step vocabulary `lib/plotspec.ts`'s
// `markSeriesStyle` established for the whole-spec "mark" (scatter/line/step,
// shipped in 954c8bf/163864b) -- a zero width IS "no line" (marker-only);
// `marker` overlays points on a connected line ("Line + Symbol"); `step`
// carries its own pre/post/mid alignment (`StepMode`, reused verbatim, not
// re-declared). This module adds no parallel mark enum: "mode" here is only
// the per-SERIES UI grouping of those same three fields -- the exact
// derivation `SeriesStyleCard`'s local `TraceMode` already uses on the Stage,
// extended with "step" to match the shipped mark vocabulary.

import type { ErrorBinding } from "../../../lib/errorRoles";
import type { SeriesStyle, StepMode } from "../../../lib/types";

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

const describeBindings = (bindings: readonly ErrorBinding[], labels: readonly string[]): string =>
  bindings
    .map((binding) => {
      const name = labels[binding.channel] ?? `channel ${binding.channel}`;
      return binding.side === "both" ? name : `${name} (${binding.side})`;
    })
    .join(", ");

/** Read-only summary of the canonical Y error bindings that describe
 *  `channel` (F2.3b: DISPLAY only in the Series group -- `document.bindings.
 *  errors` is canonical and editable, but through the separate Error columns
 *  group, F2.3f's ErrorColumnsPanel, not a per-row toggle here). */
export function describeSeriesErrors(
  bindings: readonly ErrorBinding[],
  channel: number,
  labels: readonly string[],
): string {
  const matches = bindings.filter((binding) => binding.axis === "y" && binding.target === channel);
  return matches.length ? describeBindings(matches, labels) : "none";
}

/** X-axis-wide error bindings (`target === -1`) describe the shared X column,
 *  not any one series -- summarized once for the panel instead of repeated
 *  per row. Null when there is nothing to show. */
export function describeXAxisErrors(
  bindings: readonly ErrorBinding[],
  labels: readonly string[],
): string | null {
  const matches = bindings.filter((binding) => binding.axis === "x" && binding.target === -1);
  return matches.length ? describeBindings(matches, labels) : null;
}
