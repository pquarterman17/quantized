// The SINGLE-DATASET, across-channels waterfall offset — the stagger
// `view.waterfall` applies to one plot's own series. (Its across-DATASETS
// namesake, the MATLAB `generateWaterfall.m` port, is `lib/waterfall.ts`; the
// two are unrelated features that happen to share a word.)
//
// Shared by the two producers that must agree on the number: the CANVAS
// (`lib/plotdata.ts`'s `applyWaterfall`, the first step of
// `composeDisplayPayload`) and the EXPORT WIRE (`lib/figureSpec.ts`, which
// emits `FigureSpec.waterfall_offsets`). BUG-013: the export used to carry no
// waterfall at all, so a staggered screen exported as overlaid curves.
//
// WHY THE WIRE CARRIES RESOLVED OFFSETS AND NOT THE RAW FRACTION. `view.
// waterfall` is a fraction of the y-RANGE, and the range the canvas measures is
// not reconstructible from the request the backend receives:
//   * HIDDEN series stay in the canvas payload (`usePlotPayload` leaves them in
//     `payload.series` with `show:false`), so they both widen the span and
//     occupy a display slot — but they are filtered out of the wire's `y_keys`;
//   * EXCLUDED / filter-dropped rows are still in the payload when the offset is
//     computed (`composeDisplayPayload` runs `applyWaterfall` BEFORE
//     `maskExcludedPayload`), but `pruneToLiveDataset` strips them from the wire
//     `dataset`;
//   * a decimated fetch can trim the extremes the span is measured from.
// A server-side `fraction * span` would therefore disagree with the screen the
// moment a user hides a series or excludes a row — re-opening the very bug.
// Resolving the offsets HERE, from the same display list and the same unpruned
// values the canvas uses, makes the two numerically identical by construction.
// It also keeps the wire honest: `dataset` still carries the true data (an
// exported data table or CSV built from the same spec is unaffected); the
// offset is declared as render metadata beside it.

import type { DataStruct } from "./types";

/** The per-index vertical step of a waterfall: `fraction` of the combined
 *  y-range of `columns` (every plotted VALUE column, x excluded). A degenerate
 *  range (no finite values, or a single repeated value) falls back to a span of
 *  1, so the offset is still visible — the canvas' long-standing behaviour. */
export function waterfallStep(
  columns: readonly (readonly (number | null)[])[],
  fraction: number,
): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const col of columns) {
    for (const v of col) {
      if (v != null && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return fraction * (hi > lo ? hi - lo : 1);
}

/** The `waterfall_offsets` half of a `FigureSpec`, or `{}` when the view has no
 *  waterfall (so an ordinary export's wire is byte-identical to before).
 *
 *  `displayChannels` is the UNFILTERED display list — the canvas' own index
 *  space, the same one `lib/figureSpec.ts` resolves series colours against
 *  (BUG-015) — and `positions` is each PLOTTED series' slot in it, so a hidden
 *  series reserves its stagger step exactly as it does on screen. Every plotted
 *  series is offset, secondary-axis ones included: `applyWaterfall` shifts every
 *  value column of the payload, and the y2 columns are in it.
 *
 *  REFUSED for the two request shapes whose renderer cannot align a list keyed
 *  by `y_keys`: a `group_col` split (the backend expands each channel into one
 *  synthetic series per level — the same reason `series_styles` is documented as
 *  unapplied there) and a resolved `facets` grid (which renders from its own
 *  panel payloads and ignores the flat `dataset` fields). Omitting the field is
 *  the honest response: the renderer never receives an offset it would silently
 *  mis-apply. Both combinations already export unstyled today; see BUG-013's
 *  completion record. */
export function waterfallWire(
  data: DataStruct,
  displayChannels: readonly number[],
  positions: readonly number[],
  fraction: number,
  groupKey: number | null | undefined,
  facets: readonly unknown[] | undefined,
): { waterfall_offsets?: number[] } {
  // `< 2` mirrors `applyWaterfall`'s `payload.data.length <= 2` (x + one value
  // column): a single series has nothing to be staggered against. The
  // group/facet refusals ride the same guard — see this function's doc.
  // `!(fraction > 0)` rather than `<= 0` so a NaN fraction from a corrupt
  // document is refused here too, instead of reaching the arithmetic below.
  if (!(fraction > 0) || displayChannels.length < 2 || groupKey != null || facets) return {};
  const step = waterfallStep(
    displayChannels.map((ch) => data.values.map((row) => row[ch])),
    fraction,
  );
  // A zero step (an all-equal column set at a vanishing fraction) is no
  // stagger at all. An overflow to Infinity needs no guard here: the backend
  // skips any non-finite offset (`calc.plotting.apply_waterfall_offsets`).
  if (!step) return {};
  return { waterfall_offsets: positions.map((p) => p * step) };
}
