// Lazy half of view-window min/max decimation (lib/plotDecimate.ts keeps the
// eligibility checks and constants every plot needs). Only the CLIENT-side
// path (the offline fallback and any payload the server did not decimate)
// loads this: PlotViewport imports it when `decimationEligible` says so and
// rebuilds once it lands. Server-decimated payloads never need it.
import type uPlot from "uplot";

import { DECIMATE_SETTLE_MS, bucketsForWidth } from "./plotDecimate";

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

/** Wide-plot bound (live audit: 200k rows x 49 channels). The shared-x union
 *  below is ~min(n, 2 * buckets * nSeries) rows, so a wide plot kept nearly
 *  every row. The bucket count is scaled down so the union stays under this
 *  many rows whatever the series count; each series still keeps its own
 *  per-bucket min/max, over fewer, wider buckets. The server twin
 *  (`gap_plan` in calc/decimate.py) goes further: a gapped payload carries
 *  per-series `kept` positions, and `ungap` (plotUngap.ts, lazy) turns the rest into filler. */
export const GAP_ROW_CAP = 16_000;

export function cappedBuckets(buckets: number, nSeries: number): number {
  return Math.min(buckets, Math.max(16, (GAP_ROW_CAP / (2 * nSeries)) | 0));
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
    const v = xs[i]; // NaN and null fail both comparisons, so need no finite check
    if (v != null && v >= xMin && v <= xMax) {
      if (lo === -1) lo = i;
      hi = i;
    }
  }
  return lo === -1 ? [0, 0] : [lo, hi + 1]; // half-open [lo, hi)
}


/** Re-bucket `data` (x + N series, index-aligned) to the visible window
 *  `[xMin, xMax]` padded by ~1 bucket-width of ROWS on each side, at up to
 *  `bucketsForWidth(widthPx)` buckets (fewer for a wide plot: see
 *  `cappedBuckets`). Every series contributes its own min/max rows (see
 *  `decimateRowIndices`); the union is gathered from x and every series so
 *  all columns stay the same length and index-aligned. When
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
  const buckets = cappedBuckets(bucketsForWidth(widthPx), series.length);
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
