// Distribution workshop pure geometry (ORIGIN_GAP #52 item 6): histogram
// bar → analysis-row mapping for brushing, and the box/quantile strip's
// percentage positioning. Given the per-row column values used to build a
// histogram (in the SAME pruned-row order as lib/rowstate.analysisData) and
// the histogram's bin edges, resolve which PRUNED-row indices fall in a bin
// (or a drag-spanned range of bins). Callers expand pruned indices to
// ORIGINAL row indices with rowstate's activeRowIndices (the analysis view's
// kept-index list) before writing the shared #50 `selection`.
//
// Bin membership matches numpy.histogram: each bin is half-open [lo, hi)
// except the LAST bin, which is closed [lo, hi] (so the max value lands in
// the last bar instead of being dropped).

export interface BinRange {
  lo: number;
  hi: number;
  inclusiveHi: boolean;
}

/** The value range covered by bins [i0, i1] (order-independent; i1 defaults
 *  to i0 for a single bar). */
export function binRange(edges: readonly number[], i0: number, i1: number = i0): BinRange {
  const loBin = Math.min(i0, i1);
  const hiBin = Math.max(i0, i1) + 1;
  return {
    lo: edges[loBin],
    hi: edges[hiBin],
    inclusiveHi: hiBin === edges.length - 1,
  };
}

/** Indices (into `values`) whose value falls within `range`. Non-finite
 *  values never match (mirrors the backend histogram, which drops them
 *  before binning). */
export function rowsInRange(values: readonly number[], range: BinRange): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < range.lo) continue;
    if (range.inclusiveHi ? v > range.hi : v >= range.hi) continue;
    out.push(i);
  }
  return out;
}

/** Pruned-row indices in bins [i0, i1] of a histogram (edges) over `values`
 *  — the one-shot helper the Distribution hook's brush handler calls. */
export function rowsInBins(
  edges: readonly number[],
  values: readonly number[],
  i0: number,
  i1: number = i0,
): number[] {
  return rowsInRange(values, binRange(edges, i0, i1));
}

/** Position of `v` as a percentage of [lo, hi], clamped to [0, 100] — places
 *  the box/quantile strip's markers under the histogram's x domain. Non-
 *  finite or a degenerate domain both fall back to 0. */
export function pctPosition(v: number, lo: number, hi: number): number {
  if (!(hi > lo) || !Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
}
