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
//     `dataset`.
// A server-side `fraction * span` would therefore disagree with the screen the
// moment a user hides a series or excludes a row — re-opening the very bug.
// Resolving the offsets HERE, from the same display list the canvas uses, makes
// the two numerically identical. It also keeps the wire honest: `dataset` still
// carries the true data (an exported data table or CSV built from the same spec
// is unaffected); the offset is declared as render metadata beside it.
//
// WHICH ROWS THE SPAN IS MEASURED OVER (BUG-013 review round). The canvas does
// NOT scan the whole DataStruct: `applyWaterfall` scans `payload.data`, the rows
// the fetch returned. Those are the same rows for an ordinary plot, and for a
// server-DECIMATED one too (min/max bucketing keeps each series' own extremes by
// construction — `src/quantized/calc/decimate.py`), but they are NOT the same
// once a committed zoom triggers `usePlotPayload`'s windowed re-fetch: that asks
// for `[x_min, x_max]` only (`routes/plot.py` windows before it decimates), so a
// large excursion outside the visible window is in the DataStruct and not in the
// payload. Measured: 20 000 rows with the excursion in rows [0,100) and
// `xLim [5000,6000]` staggered by 0.25 on screen and by 499.75 on the wire.
// The fix is `publishLiveWaterfallSpan` below — the focused canvas publishes the
// span it actually measured, and `figureSpecStage.buildStageFigureSpec` reads it back
// at export time, so that export uses the canvas' own number rather than a
// second derivation of it. The span is keyed by the dataset the PAYLOAD was
// fetched for, not by whichever dataset the store is currently pointing at; see
// `Stage/useLiveSnapshotPublish`'s `payloadDatasetId` for the mid-flight race
// that distinction closes.
//
// THE NO-LIVE-CANVAS FALLBACK (BUG-013 round 3). A render with no published
// span behind it (a Figure Page panel, a graph template, a saved Library
// figure, a Figure Builder preview) measures the span by BUILDING the payload
// its own canvas would draw — `plotdata.buildColumns` over the CANVAS' channel
// list and this request's x channel, then `plotdata.dropTrailingEmptyRows`,
// which is the literal tail of both `fetchPlot` return paths. It used to map
// `data.values` over the REQUEST's `displayChannels` instead, and the two
// differ in two measured ways:
//   * `allowExplicitXAsY` keeps an X channel in `displayChannels` as a Y series
//     that the canvas never draws, so its values widened the span: exported
//     offsets [500, 0, 250] against canvas shifts [0, 49.75];
//   * every canvas payload has been through `dropTrailingEmptyRows`, and the
//     raw DataStruct has not — on the Origin over-allocation artefact that
//     function exists for, export 18.75 against canvas 6.25.
// A frozen figure document is measured this way too, and deliberately: it
// ignores the live dataset entirely (`figureSpec.resolveFigureDocumentData`),
// so its own snapshot is the only honest span source.
//
// RESIDUAL (recorded, not fixed). The Figure Builder's own export of a window
// (`components/workshops/figurebuilder/previewExport.ts:55` and
// `figurebuilder/canonicalReadiness.ts:60`) calls `buildFigureSpecFromDocument`
// with no span, so it takes the fallback above while `Export figure…` on the
// focused Stage takes the canvas' windowed span — two staggers for one figure
// whenever a committed zoom has narrowed a server-decimated payload. The span
// is NOT threaded there on purpose: this seam is written by the FOCUSED Stage
// canvas alone, and the Figure Builder renders a TARGET window that need not be
// the focused one (`figurebuilder/canonicalSession.ts` documents focus as not a
// styling input). Feeding it a focus-derived number would make the preview
// change when the user clicks another window — the class
// `components/windows/BackgroundPlotWindow.tsx`'s header names. Closing it
// properly means publishing per-window spans, which is a wider change than this
// round.

import { buildColumns, dropTrailingEmptyRows } from "./plotdata";
import { overlayModesMatchTheCanvas, type CycleView } from "./seriesStyleCycle";
import type { DataStruct } from "./types";

/** Is there a stagger to apply at all? THE shared guard: `applyWaterfall` and
 *  `waterfallWire` both ask this one function, so the canvas cannot stagger a
 *  view the wire refuses (or the reverse). Written as `> 0` rather than
 *  `!(<= 0)` so a NaN fraction — unreachable from a PARSED document
 *  (`lib/plotview.ts`'s `num()` rejects every non-finite number) but reachable
 *  from a hand-built view object — is refused by BOTH sides instead of one
 *  early-returning while the other NaNs every value column. */
export function waterfallApplies(fraction: number): boolean {
  return fraction > 0;
}

/** The combined y-range of `columns` (every plotted VALUE column, x excluded)
 *  — the span a waterfall step is a fraction of. A degenerate range (no finite
 *  values, or a single repeated value) falls back to 1, so the offset is still
 *  visible — the canvas' long-standing behaviour. */
export function waterfallSpan(columns: readonly (readonly (number | null)[])[]): number {
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
  return hi > lo ? hi - lo : 1;
}

/** The value columns a canvas with no live payload behind it would draw, built
 *  exactly the way `plotdata.fetchPlot`'s offline path builds them: pack the
 *  canvas' channels against this request's x channel, then drop the trailing
 *  empty/over-allocated rows every fetched payload has already had dropped. The
 *  span the wire falls back to is measured over THESE columns — see the
 *  module header for the two divergences that reading `data.values` directly
 *  produced. */
function canvasColumns(
  data: DataStruct,
  channels: readonly number[],
  xKey: number | null,
): (number | null)[][] {
  const packed = dropTrailingEmptyRows(buildColumns(data, null, xKey, [...channels]));
  return (packed.data as unknown as (number | null)[][]).slice(1);
}

/** The per-index vertical step of a waterfall: `fraction` of `waterfallSpan`. */
export function waterfallStep(
  columns: readonly (readonly (number | null)[])[],
  fraction: number,
): number {
  return fraction * waterfallSpan(columns);
}

// ── The live-canvas seam (BUG-013 review round) ─────────────────────────────
// A module-scope ref, the same shape `lib/plotsnapshot.ts` uses for the composed
// display bundle: an imperative write from a `PlotStage` effect (via
// `Stage/useLiveSnapshotPublish`, which already owns that effect and already
// no-ops in the alternate render modes), read back by the export at command
// time. Not store state — publishing must cause no re-render.

let _liveSpan: { datasetId: string | null; span: number } | null = null;

/** Publish (or clear, with null) the y-span the focused XY canvas measured its
 *  waterfall stagger from. The ONLY writer is `Stage/useLiveSnapshotPublish`. */
export function publishLiveWaterfallSpan(v: { datasetId: string | null; span: number } | null): void {
  _liveSpan = v;
}

/** The focused canvas' span for `datasetId`, or null when no XY canvas is
 *  showing that dataset. The id check is the guard for `exportActive`'s
 *  documented refocus race (`figureSpecStage.buildStageFigureSpec`): a span measured
 *  from a DIFFERENT dataset's payload must never silently stagger this one. */
export function readLiveWaterfallSpan(datasetId: string): number | null {
  return _liveSpan && _liveSpan.datasetId === datasetId ? _liveSpan.span : null;
}

/** The `waterfall_offsets` half of a `FigureSpec`, or `{}` when the view has no
 *  waterfall (so an ordinary export's wire is byte-identical to before).
 *
 *  `canvasChannels` is the CANVAS' display list (`lib/figureSpecSeries.
 *  resolveDisplaySeries`) — the index space `positions` are slots in, so a
 *  hidden series reserves its stagger step exactly as it does on screen — and
 *  the list the fallback span is measured over. Every plotted series is offset,
 *  secondary-axis ones included: `applyWaterfall` shifts every value column of
 *  the payload, and the y2 columns are in it.
 *
 *  REFUSED for every view whose canvas is not the plain single-panel XY overlay
 *  this field is keyed to, through the SAME predicate the canvases and the
 *  series-style cycle ask (`seriesStyleCycle.overlayModesMatchTheCanvas`):
 *  a `group_col` split and a resolved `facets` grid, whose renderers cannot
 *  align a list keyed by `y_keys` at all (the backend expands each channel into
 *  one synthetic series per level; the facet branch renders from its own panel
 *  payloads) — and `stackMode`/`polarMode`/`statMode`, where the XY canvas is
 *  replaced outright and NOTHING is staggered on screen, so emitting offsets
 *  staggered an export the user's screen never did. Omitting the field is the
 *  honest response: the renderer never receives an offset it would mis-apply.
 *
 *  The GROUP clause of that predicate is asked about the grouping this request
 *  actually carries, not the view's raw binding (BUG-013 round 3). `groupCol`
 *  is REQUIRED and carries that answer directly — the exact value
 *  `figureSpec.ts` already resolved with `plotGroupSplit.canvasGroupCol`
 *  (the same rule `Stage/usePlotPayload` applies to decide what to draw;
 *  NIT 9 deleted the one-line `figureSpecGroup.resolveGroupCol` alias that
 *  used to sit between them) and put on the wire as `group_col`. Round 4
 *  had this fall back to a SECOND `canvasGroupCol` call over the view's raw
 *  binding whenever `groupCol` was `null` — indistinguishable from "not
 *  resolved yet" — so a route that resolved `group_col` to null (an explicit
 *  degrade) and a route that never resolved anything at all read the SAME
 *  `null` and disagreed on what it meant: on the live `buildFigureSpec` route,
 *  `group_col` came out absent while the fallback still read the view's own
 *  `groupKey` and refused the offsets. One required argument, no fallback,
 *  removes the second reading entirely.
 *
 *  `span` is the canvas' own measured y-range when a live XY canvas published
 *  one for this request (see `readLiveWaterfallSpan`); absent, see the
 *  no-live-canvas fallback in this module's header. */
export function waterfallWire(args: {
  data: DataStruct;
  canvasChannels: readonly number[];
  positions: readonly number[];
  fraction: number;
  view: CycleView;
  span?: number | null;
  /** The `group_col` this spec emits — `null` means the request draws a plain
   *  ungrouped overlay whatever the view binds. REQUIRED, and the caller's
   *  ONLY resolution of it: see this function's doc for why a fallback here
   *  read a second, possibly-disagreeing answer. */
  groupCol: number | null;
}): { waterfall_offsets?: number[] } {
  // `< 2` mirrors `applyWaterfall`'s `payload.data.length <= 2` (x + one value
  // column): a single series has nothing to be staggered against. Asked about
  // the CANVAS' list, because that is what `applyWaterfall` counts — an X-as-Y
  // request can carry two display channels while the canvas draws one curve.
  if (!waterfallApplies(args.fraction) || args.canvasChannels.length < 2) return {};
  if (!overlayModesMatchTheCanvas({ ...args.view, groupKey: args.groupCol })) return {};
  const span =
    args.span != null && Number.isFinite(args.span)
      ? args.span
      : waterfallSpan(canvasColumns(args.data, args.canvasChannels, args.view.xKey));
  const step = args.fraction * span;
  // A zero step (an all-equal column set at a vanishing fraction) is no
  // stagger at all. An overflow to Infinity needs no guard here: the backend
  // skips any non-finite offset (`calc.plotting.apply_waterfall_offsets`).
  if (!step) return {};
  return { waterfall_offsets: args.positions.map((p) => p * step) };
}
