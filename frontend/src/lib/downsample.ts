// Min/max-per-bucket downsampling for preview-scale line plots (Library
// sparklines, PERF_ORIGIN_IMPORT_PLAN fix 3). A dataset can have tens of
// thousands of points feeding a ~180px-wide thumbnail; plain stride
// decimation (every Nth point) silently erases spikes that fall between the
// sampled indices, so each bucket instead keeps its min-y AND max-y point
// (in original left-to-right order), preserving the visual envelope. Short
// series (at or under the bucket count) are returned untouched — there is
// nothing to gain by bucketing fewer points than buckets.
//
// Also returns the exact global x/y bounds (computed in the same single
// pass as the bucketing), so a caller never needs a second full pass over
// the raw data just to scale the plot.

/**
 * Trailing-padding index for an (xs, ys) pair, mirroring `lib/plotdata.ts`'s
 * `dropTrailingEmptyRows` (kept as a standalone twin here rather than a
 * cross-import, since a sparkline computes its own single-channel x/y pair
 * straight off a `DataStruct` instead of a full uPlot `PlotPayload`). Origin's
 * over-allocated worksheet storage leaves trailing "allocated but unfilled"
 * rows — either non-finite, or (rarer, verified across ~10 PNR-corpus books)
 * an exact simultaneous `x === 0 && y === 0` "point" that isn't a gap at all.
 * Left in, either resets the x-axis back toward 0 at the tail, collapsing a
 * sparkline built from the raw row order toward the origin instead of
 * tracing the real curve.
 *
 * Returns the new count of leading rows to keep (i.e. the caller should treat
 * indices `[0, returned)` as the real series and pass that as `n` to
 * `downsampleMinMax`); `n` unchanged when there is no prunable tail. Only
 * trims a contiguous run off the END — interior gaps are left in place.
 */
export function trimTrailingPadding(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): number {
  const plottable = (i: number): boolean => Number.isFinite(xs[i]) && Number.isFinite(ys[i]);
  const allZeroRow = (i: number): boolean => xs[i] === 0 && ys[i] === 0;
  let end = n;
  while (end > 0 && (!plottable(end - 1) || allZeroRow(end - 1))) end--;
  return end;
}

export interface DownsampledSeries {
  xs: number[];
  ys: number[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Downsample `xs`/`ys` (both length `n`, index-aligned) to at most
 * `2 * buckets` points via min/max-per-bucket, plus the exact global bounds
 * over every finite (x, y) pair. Non-finite pairs are dropped, matching the
 * caller's prior NaN-skip behavior. When `n <= buckets`, every finite pair
 * is returned unchanged (no bucketing).
 */
export function downsampleMinMax(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  n: number,
  buckets: number,
): DownsampledSeries {
  const outXs: number[] = [];
  const outYs: number[] = [];
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  const bucketCount = Math.max(1, Math.floor(buckets));

  if (n <= bucketCount) {
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      outXs.push(x);
      outYs.push(y);
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    return { xs: outXs, ys: outYs, xMin, xMax, yMin, yMax };
  }

  const bucketSize = n / bucketCount;
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * bucketSize);
    const end = b === bucketCount - 1 ? n : Math.floor((b + 1) * bucketSize);
    let minIdx = -1;
    let maxIdx = -1;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = start; i < end; i++) {
      const x = xs[i];
      const y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
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
    if (minY < yMin) yMin = minY;
    if (maxY > yMax) yMax = maxY;
    if (minIdx === maxIdx) {
      outXs.push(xs[minIdx]);
      outYs.push(ys[minIdx]);
    } else if (minIdx < maxIdx) {
      outXs.push(xs[minIdx], xs[maxIdx]);
      outYs.push(ys[minIdx], ys[maxIdx]);
    } else {
      outXs.push(xs[maxIdx], xs[minIdx]);
      outYs.push(ys[maxIdx], ys[minIdx]);
    }
  }
  return { xs: outXs, ys: outYs, xMin, xMax, yMin, yMax };
}
