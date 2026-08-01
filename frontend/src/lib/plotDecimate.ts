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

import type uPlot from "uplot";

function seriesBucketIndices(
  ys: ArrayLike<number | null>,
  lo: number,
  hi: number,
  buckets: number,
): number[] {
  const n = hi - lo;
  if (n <= 0) return [];
  const out: number[] = [];
  const bucketCount = Math.max(1, Math.min(buckets, n));
  if (n <= bucketCount) {
    for (let i = lo; i < hi; i++) out.push(i);
    return out;
  }
  // Mirrors downsample.ts's downsampleMinMax bucket math (start/end via
  // n/bucketCount), kept as a standalone twin rather than a cross-import: that
  // module gathers VALUES over the whole array with no window/lo-hi concept,
  // this one gathers INDICES over an arbitrary [lo, hi) slice so the caller can
  // apply the same index set to every aligned column (see downsample.ts's own
  // `trimTrailingPadding` doc for the precedent of a deliberate standalone twin).
  const bucketSize = n / bucketCount;
  for (let b = 0; b < bucketCount; b++) {
    const start = lo + Math.floor(b * bucketSize);
    const end = b === bucketCount - 1 ? hi : lo + Math.floor((b + 1) * bucketSize);
    let minIdx = -1;
    let maxIdx = -1;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = start; i < end; i++) {
      const y = ys[i];
      if (y == null || !Number.isFinite(y)) continue;
      if (y < minY) {
        minY = y;
        minIdx = i;
      }
      if (y > maxY) {
        maxY = y;
        maxIdx = i;
      }
    }
    if (minIdx < 0) continue; // no finite points in this bucket
    if (minIdx === maxIdx) out.push(minIdx);
    else out.push(minIdx, maxIdx); // order doesn't matter — the caller sorts the union
  }
  return out;
}

/** The union, ascending and deduped, of every series' own min/max bucket
 *  picks over `[lo, hi)`. Union (not one shared pick) so each series keeps
 *  ITS OWN peaks — a channel whose extrema fall in different rows than its
 *  neighbour is common (independent measurement columns) and a single shared
 *  bucket-index choice would flatten whichever channel didn't drive the pick. */
export function decimateRowIndices(
  series: readonly ArrayLike<number | null>[],
  lo: number,
  hi: number,
  buckets: number,
): number[] {
  const set = new Set<number>();
  for (const ys of series) {
    for (const idx of seriesBucketIndices(ys, lo, hi, buckets)) set.add(idx);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** [firstRow, lastRow) whose x falls within [xMin, xMax], scanning every row
 *  rather than assuming a binary-searchable sorted array — x may carry
 *  interior nulls (gaps) even while passing `uplotOpts.xIsAscending`'s
 *  skip-nulls check. Returns `[0, 0]` (empty) when nothing is in range; the
 *  caller's padding still includes a neighbour row so a fully-panned-off-data
 *  view degrades to "one harmless off-screen point" rather than a crash. */
export function visibleRowRange(
  xs: ArrayLike<number | null>,
  xMin: number,
  xMax: number,
): [number, number] {
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (v >= xMin && v <= xMax) {
      if (lo === -1) lo = i;
      hi = i;
    }
  }
  return lo === -1 ? [0, 0] : [lo, hi + 1]; // half-open [lo, hi)
}

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
  defaultTrace?: string;
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

/** Re-bucket `data` (x + N series, index-aligned) to the visible window
 *  `[xMin, xMax]` padded by ~1 bucket-width of ROWS on each side, at up to
 *  `bucketsForWidth(widthPx)` buckets. Every series contributes its own
 *  min/max rows (see `decimateRowIndices`); the union is gathered from x and
 *  every series so all columns stay the same length and index-aligned. When
 *  the padded row span already has fewer rows than buckets, every row in it
 *  is kept (the bucketing math's own identity passthrough) — so zooming in
 *  always re-resolves toward full detail, never a fixed low-res copy. */
export function buildDecimatedData(
  data: readonly ArrayLike<number | null>[],
  xMin: number,
  xMax: number,
  widthPx: number,
): (number | null)[][] {
  const [xs, ...series] = data;
  const n = xs.length;
  const buckets = bucketsForWidth(widthPx);
  const [lo0, hi0] = visibleRowRange(xs, xMin, xMax);
  const padRows = Math.max(1, Math.ceil((hi0 - lo0) / buckets));
  const lo = Math.max(0, lo0 - padRows);
  const hi = Math.min(n, hi0 + padRows);
  const rows = series.length > 0 ? decimateRowIndices(series, lo, hi, buckets) : [];
  const gatherCol = (col: ArrayLike<number | null>): (number | null)[] => rows.map((i) => col[i]);
  return [gatherCol(xs), ...series.map(gatherCol)];
}

/** uPlot plugin: on every settled x-scale change (debounced `settleMs` after
 *  the last `setScale("x", ...)` call — a live pan/wheel/box-zoom gesture
 *  fires many of these), re-buckets `getFullData()` (the ORIGINAL, undecimated
 *  columns — kept in memory by the caller, never mutated here) to the new
 *  visible window at the plot's current pixel width and calls
 *  `u.setData(..., false)`. `false` (no scale reset) is what makes this
 *  invisible to the user: the view they already navigated to is preserved,
 *  only the point density under it changes.
 *
 *  Ignores uPlot's OWN construction-time scale-establishment calls (which
 *  fire before the plugin's `ready` hook) so mounting never immediately
 *  re-triggers a redundant rebucket of the same window the caller already
 *  built the initial data for. */
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
  defaultTrace?: string;
  hasErrorBars: boolean;
  hasErrorSpans: boolean;
  hasColorByColumns: boolean;
}): boolean {
  if (args.hasErrorBars || args.hasErrorSpans) return false;
  if ((args.defaultTrace ?? "Line") === "Scatter") return false;
  if (args.hasColorByColumns) return false;
  return true;
}

export function decimatePlugin(
  getFullData: () => readonly ArrayLike<number | null>[],
  settleMs: number = DECIMATE_SETTLE_MS,
): uPlot.Plugin {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let armed = false;
  return {
    hooks: {
      ready: () => {
        armed = true;
      },
      setScale: (u: uPlot, key: string) => {
        if (!armed || key !== "x") return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          const xMin = u.scales.x.min;
          const xMax = u.scales.x.max;
          if (xMin == null || xMax == null) return;
          const widthPx = u.bbox.width || u.width || 1;
          u.setData(buildDecimatedData(getFullData(), xMin, xMax, widthPx) as uPlot.AlignedData, false);
        }, settleMs);
      },
      destroy: () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    },
  };
}
