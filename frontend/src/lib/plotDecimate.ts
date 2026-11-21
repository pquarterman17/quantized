// View-window min/max decimation for the dense uPlot render path (P0.4 follow-up
// to docs/performance_envelope.md's #1 finding). A correct min/max-bucket
// downsampler already existed (downsample.ts) but fed only Library sparklines —
// the interactive plot path (usePlotPayload -> plotdata.buildColumns -> uPlot)
// plotted every raw point, measured at zoom p95 259 ms / 78 MB payload at
// 1M rows x 7 series (target <100 ms). This module is the SINGLE chokepoint for
// fixing that: PlotViewport is the only caller.
//
// Design (see the P0.4 task brief for the full rationale):
//  - View-window-aware, not static: `buildDecimatedData` re-buckets from the
//    FULL columns (kept in memory by the caller) to whatever x-window is
//    currently visible, padded by ~1 bucket each side so the drawn line
//    reaches the viewport edges cleanly.
//  - `decimatePlugin` hooks uPlot's `setScale` and re-buckets DEBOUNCED
//    (settleMs, ~100 ms) after the x scale stops changing, then calls
//    `u.setData(data, false)` — `false` so the view the user is already
//    looking at is not disturbed, only the point density under it. During the
//    live drag/wheel gesture itself, uPlot keeps rescaling whatever
//    (decimated) arrays are already loaded — THAT is where the latency win
//    comes from, not the rebucket.
//  - Buckets always keep REAL samples (min + max per bucket, in x order) —
//    never interpolated — so the cursor readout (uplotTools.readoutPlugin,
//    which reads `u.data` directly) always shows genuine data values.
//  - Row-index bucketing (not value bucketing, unlike downsample.ts's
//    gathered-xs/ys shape): every eligible series is unioned into ONE sorted
//    row-index set so every column (x + every series) is gathered by the
//    SAME rows and stays index-aligned — the mechanism that would otherwise
//    risk mis-pairing an error-bar column against its value column (see
//    `decimationEligible`'s doc for why error-bar series are excluded instead
//    of gathered independently).

import type { ErrorBinding } from "./errorRoles";
import type { DefaultTrace } from "./types";

/** [min, max] over the finite values of `xs`, or null when none are finite. */
export function xExtent(xs: ArrayLike<number | null>): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : null;
}

/** Rows/series below which decimation never engages — "typical datasets
 *  (<=10k rows) must be entirely unaffected" is a hard requirement, so this is
 *  an AND-gate with the density check below, not an independent OR-trigger:
 *  a 10k-row series at a narrow plot width would otherwise cross a plain
 *  points-per-px threshold on its own. */
export const DECIMATE_MIN_POINTS = 10_000;
/** Points-per-pixel-column above which the series is dense enough that raw
 *  rendering draws far more points than the display can resolve. */
export const DECIMATE_DENSITY_THRESHOLD = 4;
/** Buckets per pixel column when decimation is engaged; min+max per bucket
 *  yields at most ~2 real samples per pixel column. */
export const DECIMATE_BUCKETS_PER_PX = 1;
/** Debounce window (ms) after the x scale stops changing before re-bucketing
 *  the newly-visible window — long enough that a live drag/wheel burst never
 *  triggers a rebucket mid-gesture, short enough to feel immediate once it does. */
export const DECIMATE_SETTLE_MS = 100;

/** Should this series be decimated at all, independent of the current view?
 *  A one-time (per full row count / plot width) gate — the per-window bucket
 *  math in `buildDecimatedData` already degrades to "every row" once the
 *  visible slice is small, so this only needs to answer "is the WHOLE series
 *  dense enough to bother with the machinery." */
export function shouldDecimate(totalPoints: number, widthPx: number): boolean {
  if (totalPoints <= DECIMATE_MIN_POINTS || widthPx <= 0) return false;
  return totalPoints / widthPx > DECIMATE_DENSITY_THRESHOLD;
}

export function bucketsForWidth(widthPx: number): number {
  return Math.max(1, Math.round(widthPx * DECIMATE_BUCKETS_PER_PX));
}

// ── M1 (provenance-disclosure round 4, L2 regression) ──────────────────────
// `decimationEligible`/`decimationRequestEligible` both take a plain
// `hasErrorSpans`/`hasErrorBars` boolean rather than the bindings/plotted
// data itself, so every call site used to compute that boolean inline —
// three of the four collapsed it to mere PRESENCE (`!!ds.errorRoles?.length`),
// not whether any binding actually applies to what the user has plotted.
// That was survivable while `Dataset.errorRoles` was rarely populated for an
// Origin import; FU-1 (this same lane) now stamps it from real designations,
// so the imprecision became a real, common regression: any Origin book with
// EITHER a Y-error OR an X-error designation anywhere lost server-side
// decimation entirely, even when the plotted channels don't involve it at
// all. These two helpers are the ONE shared predicate every call site now
// routes through (`store/importDatasets.ts`'s FU-1 doesn't call these; this
// is the plot-render side of the same provenance fix).

/** Does any error binding in `bindings` actually apply to the channels about
 *  to be plotted? Two shapes of "applies":
 *   - a Y (or asymmetric Y+/Y-) binding: its `target` channel is in `plotted`.
 *   - an X binding (`target === -1`, applies to the x axis, not one specific
 *     channel): only when `xErrorRenders` says this render path actually
 *     DRAWS an x-error span at all.
 *
 *  `xErrorRenders` is NOT a global constant — it depends on which render path
 *  the caller feeds: the main single-plot Stage (`usePlotPayload.ts`) builds
 *  BOTH `errorSpans` (`lib/errorbars.buildErrorSpans`, which legitimately
 *  emits an X binding against every plotted column) and draws it via
 *  `errorSpansPlugin` — so there `xErrorRenders: true`, and disabling
 *  decimation for an X-error-bound dataset is CORRECT (a decimated row set
 *  would misalign those position-keyed magnitude arrays, the exact hazard
 *  `decimationEligible`'s own doc warns about). MultiPanelStage's
 *  panel/background render path (`useMultiPanelStage.ts`) builds ONLY the
 *  legacy Y-only `errorBars` (`lib/errorbars.buildErrorColumns`/`originErrKeys`,
 *  which deliberately excludes X-error — "the plugin draws vertical whiskers
 *  only") and never wires an errorSpans plugin at all — so there
 *  `xErrorRenders: false`: an X-error-only book draws NOTHING in that path,
 *  and forcing it ineligible would only cost decimation for no rendering
 *  benefit. Pre-fetch-safe: only needs the dataset's own bindings + the
 *  already-resolved plotted-channel list, no network round trip. */
export function errorBindingsApplyToPlotted(
  bindings: readonly ErrorBinding[] | undefined,
  plotted: readonly number[],
  opts: { xErrorRenders: boolean },
): boolean {
  if (!bindings || bindings.length === 0 || plotted.length === 0) return false;
  return bindings.some((b) => (b.axis === "x" ? opts.xErrorRenders : plotted.includes(b.target)));
}

/** Post-fetch precision case: `PlotViewport.tsx` already holds the REAL
 *  computed `errorBars`/`errorSpans` Map (built by `buildErrorColumns`/
 *  `buildErrorSpans` against the exact plotted set, asymmetric pairs and
 *  document-authoritative overrides already resolved) — no approximation
 *  needed, just "is it non-empty". Factored in here so every
 *  hasErrorBars/hasErrorSpans call site reads through this one module
 *  instead of repeating `!!(m && m.size > 0)` inline. */
export function hasErrorMapEntries(map: ReadonlyMap<unknown, unknown> | undefined): boolean {
  return !!map && map.size > 0;
}

/** Structural eligibility for decimation — independent of size/density
 *  (see `shouldDecimate`). All of the following must hold:
 *   - `plotted` is known and non-empty, and the payload carries EXACTLY those
 *     columns (no fit/baseline/peak/deriv overlay, no grey-mode "excluded"
 *     ghost companion, no #50 selection-brush highlight companion appended).
 *     Those companions/overlays are appended AFTER the base series in the
 *     SAME shared-x AlignedData uPlot instance, so decimating the base series
 *     to different rows than an untouched overlay would either misalign them
 *     or force the overlay's full row count back onto x anyway — this module
 *     stays out of that by disengaging whenever anything is appended.
 *   - x is ascending (`uplotOpts.xIsAscending`) — a non-monotonic sweep (a
 *     hysteresis loop) already renders via the special full-acquisition-order
 *     path (`fullLine`/loop extents), which this module's order-dependent
 *     bucketing does not model.
 *   - No error bars/spans are bound to any plotted column. `errorBarsPlugin`/
 *     `errorSpansPlugin` (uplotOverlays.ts) read their magnitude arrays from a
 *     Map captured once at `buildOpts` build time, keyed by row position —
 *     gathering the VALUE column to a reduced, re-ordered row set via
 *     `u.setData()` without an equivalent live update to that captured Map
 *     would silently misalign a bar against the wrong point. Coupling them
 *     cleanly would need `errorBarsPlugin`/`errorSpansPlugin` to read through
 *     a live getter (like `uplotOpts`'s `anchorEdit.getAnchors` bridge)
 *     instead of a captured snapshot — a larger refactor of a shared overlay
 *     module used by every plot window. Per the task's own explicit
 *     fallback, this disengages decimation entirely for series with error
 *     bars rather than risk a subtly wrong whisker; error-bar datasets are
 *     also not the dense (1M-row) case this fix targets.
 *   - `defaultTrace` is not "Scatter" and no series uses colour-mapped
 *     scatter (`colorByColumns`) — min/max bucketing changes apparent point
 *     DENSITY, which is the entire signal in a scatter/colour-mapped plot
 *     (unlike a line, where the drawn envelope is what matters). Disengaged
 *     rather than risk a scatter plot silently thinning itself. */
export function decimationEligible(args: {
  seriesColumnCount: number;
  plottedCount: number | null | undefined;
  xAscending: boolean;
  hasErrorBars: boolean;
  hasErrorSpans: boolean;
  defaultTrace?: DefaultTrace;
  hasColorByColumns: boolean;
}): boolean {
  if (!args.plottedCount || args.plottedCount <= 0) return false;
  if (args.seriesColumnCount !== args.plottedCount) return false;
  if (!args.xAscending) return false;
  if (args.hasErrorBars || args.hasErrorSpans) return false;
  if ((args.defaultTrace ?? "Line") === "Scatter") return false;
  if (args.hasColorByColumns) return false;
  return true;
}

/** Upper-bound width hint (px) for a SERVER-SIDE decimation request, made
 *  before the actual plot host is measured/mounted (the fetch effects in
 *  usePlotPayload/useMultiPanelStage run before PlotViewport's own
 *  ResizeObserver exists, so there is no real element to read `clientWidth`
 *  from yet). `window.innerWidth` is always >= any single plot's real
 *  rendered width, so bucketing against it never under-resolves a smaller
 *  panel/window -- it can only ask the server for MORE points than a given
 *  panel strictly needs, never fewer. Mirrors `lib/toolwindow.ts`'s
 *  SSR-safe `window.innerWidth` fallback. */
export function defaultDecimateWidthHint(): number {
  return typeof window !== "undefined" ? window.innerWidth : 1280;
}

/** Pre-fetch-safe subset of `decimationEligible` (P3.4 server-side payload
 *  decimation) -- the checks answerable BEFORE the network round trip. Two
 *  of `decimationEligible`'s five checks need the fetched payload itself
 *  (`xAscending`) or are trivially true for a base (pre-overlay) fetch
 *  (`seriesColumnCount === plottedCount` -- overlays are only ever appended
 *  AFTER fetch, by `composeDisplayPayload`) and so are NOT repeated here:
 *  the route independently refuses to decimate a non-ascending series (see
 *  `routes/plot.py`'s `is_ascending` guard), and the caller must separately
 *  keep requesting full resolution while any overlay/selection/exclusion
 *  companion is active for the dataset being fetched (see
 *  `usePlotPayload.ts`'s `hasOverlayCompanions` -- those append full-length
 *  columns onto the fetched payload, which a reduced row set cannot safely
 *  carry; `lib/plotdata.ts`'s `alignOverlayY` is the last-resort guard if a
 *  caller forgets).
 *
 *  The three checks left are exactly the ones a caller CAN answer from local
 *  component/store state before fetching: error bars/spans read their
 *  magnitude arrays keyed by ROW POSITION off the FULL dataset, so a reduced
 *  row set would misalign them; colour-mapped scatter reads its colour array
 *  the same way; Scatter mode's drawn point DENSITY is itself the signal, so
 *  thinning it server-side would be visually wrong the same way client-side
 *  decimation already avoids it (see `decimationEligible`'s doc for all
 *  three in full). */
export function decimationRequestEligible(args: {
  defaultTrace?: DefaultTrace;
  hasErrorBars: boolean;
  hasErrorSpans: boolean;
  hasColorByColumns: boolean;
  /** P1.5: a live Group split (usePlotPayload's `applyGroupSplit`) reads its
   *  per-row level codes off the FULL dataset, row-position-aligned to the
   *  fetched payload -- same "can't tolerate a decimated, non-1:1 row set"
   *  reasoning as error bars/color-by-column above. */
  hasGroupSplit?: boolean;
}): boolean {
  if (args.hasErrorBars || args.hasErrorSpans) return false;
  if ((args.defaultTrace ?? "Line") === "Scatter") return false;
  if (args.hasColorByColumns) return false;
  if (args.hasGroupSplit) return false;
  return true;
}

/** P3.4 zoom-refetch residual: should a committed X view-limit change trigger
 *  a windowed re-fetch of the visible window at full local detail? Only when
 *  BOTH a window is actually committed (`xLim` non-null — `null` means
 *  autoscale/reset, which restores the cached full-range payload with no
 *  fetch at all) AND the payload currently on screen came from a
 *  server-decimated BASE fetch (`baseDecimated` — an echo of the response's
 *  own `decimated` flag, not a re-derivation of the client-side eligibility
 *  heuristic: whatever the server actually did is the single source of
 *  truth for "is there more local detail to recover here"). A small or
 *  overlay-companion-bearing dataset is never decimated in the first place
 *  (see `usePlotPayload.ts`'s `hasOverlayCompanions`), so `baseDecimated`
 *  is already false for it — this function needs no separate companion
 *  check to inherit that gating. */
export function shouldRefetchWindow(xLim: [number, number] | null, baseDecimated: boolean): boolean {
  return xLim != null && baseDecimated;
}
