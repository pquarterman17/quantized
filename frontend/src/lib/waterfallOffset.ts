// The SINGLE-DATASET, across-channels waterfall offset — the stagger
// `view.waterfall` applies to one plot's own series. (Its across-DATASETS
// namesake, the MATLAB `generateWaterfall.m` port, is `lib/waterfall.ts`; the
// two are unrelated features that happen to share a word.)
//
// Shared by the two producers that must agree on the number: the CANVAS
// (`lib/plotdata.ts`'s `applyWaterfall`, the first step of
// `composeDisplayPayload`) and the EXPORT WIRE (`lib/waterfallWire.ts`, called by
// `lib/figureSpec.ts`, which emits `FigureSpec.waterfall_offsets`). Origin's X
// step (`view.waterfallDx`) follows the same rules: canvas `lib/waterfallX.ts`,
// wire `waterfall_x_offsets` from the same builder. BUG-013: the export used
// to carry no waterfall at all, so a staggered screen exported as overlaid
// curves.
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

import type { PlotPayload } from "./plotdata";

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

/** The X half's guard (Origin's waterfall X step, `view.waterfallDx`): any
 *  finite non-zero fraction of the x-span — a NEGATIVE step slides the series
 *  left, as Origin's does. Shared by the canvas (`lib/waterfallX.ts`), its lazy
 *  loader (`Stage/useWaterfallX`) and `waterfallWire`, for the reason above. */
export function waterfallXApplies(fraction: number): boolean {
  return fraction !== 0 && Number.isFinite(fraction);
}

/** Brushed display rows -> dataset rows. An X-offset payload repeats every row
 *  once per x block (`PlotPayload.blockRows`, set by `lib/waterfallX.ts`), so
 *  a band across blocks names the same dataset row more than once. */
export function waterfallSourceRows(payload: PlotPayload, rows: number[]): number[] {
  const m = payload.blockRows;
  return m ? [...new Set(rows.map((r) => r % m))] : rows;
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

/** The x-span the X step is a fraction of: the FULL-range fetch's, which a zoom
 *  re-fetch stamps on its windowed payload (`withFullXSpan`), so the stagger does
 *  not shrink on zoom. The canvas and the live export span both read it here. */
export function waterfallXSpanOf(payload: PlotPayload): number {
  const x = (payload.data as unknown as (number | null)[][])[0] ?? [];
  return (payload as XSpanned).fullXSpan ?? waterfallSpan([x]);
}

// Kept off `PlotPayload` itself (plotdata.ts is at its size pin): only these
// two functions write or read it.
type XSpanned = PlotPayload & { fullXSpan?: number };

/** `windowed` (a zoom re-fetch) stamped with its full-range `base`'s x-span. */
export function withFullXSpan(windowed: PlotPayload, base: PlotPayload): PlotPayload {
  const out: XSpanned = { ...windowed, fullXSpan: waterfallXSpanOf(base) };
  return out;
}

/** A committed zoom `[lo, hi]` is in SHIFTED x, but `/api/plot/series` windows
 *  RAW x (before decimating). Slot k draws x + k·step, so it needs raw
 *  [lo − k·step, hi − k·step]; one shared x column means fetching the union
 *  over every slot of `base` (the full-range fetch). Identity without a step,
 *  so every non-waterfall plot windows exactly as before. */
export function waterfallXFetchWindow(base: PlotPayload, [lo, hi]: readonly [number, number], fraction: number): [number, number] {
  const n = base.series.length;
  const far = waterfallXApplies(fraction) && n > 1 ? (n - 1) * fraction * waterfallXSpanOf(base) : 0;
  return Number.isFinite(far) ? [lo - Math.max(far, 0), hi - Math.min(far, 0)] : [lo, hi];
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

let _liveSpan: { datasetId: string | null; span: number; xSpan?: number } | null = null;

/** Publish (or clear, with null) the y-span the focused XY canvas measured its
 *  waterfall stagger from, and the x-span its X step (`xSpan`) is a fraction
 *  of. The ONLY writer is `Stage/useLiveSnapshotPublish`. */
export function publishLiveWaterfallSpan(v: { datasetId: string | null; span: number; xSpan?: number } | null): void {
  _liveSpan = v;
}

/** The focused canvas' span for `datasetId`, or null when no XY canvas is
 *  showing that dataset. The id check is the guard for `exportActive`'s
 *  documented refocus race (`figureSpecStage.buildStageFigureSpec`): a span measured
 *  from a DIFFERENT dataset's payload must never silently stagger this one.
 *  `key: "xSpan"` reads the X step's span instead, behind the same guard. */
export function readLiveWaterfallSpan(datasetId: string, key: "span" | "xSpan" = "span"): number | null {
  return _liveSpan && _liveSpan.datasetId === datasetId ? (_liveSpan[key] ?? null) : null;
}
