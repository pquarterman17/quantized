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

// The per-series mode vocabulary (`SeriesMode`, its options and
// `seriesModeOf`/`seriesModePatch`) moved verbatim to lib/seriesMode.ts so the
// figures-audit #8 plot-type gallery (a lib module) can share it; re-exported
// here so no importer changed.
export { SERIES_MODE_OPTIONS, STEP_ALIGN_OPTIONS, seriesModeOf, seriesModePatch, type SeriesMode } from "../../../lib/seriesMode";

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
