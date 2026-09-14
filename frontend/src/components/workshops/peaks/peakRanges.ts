// The finite-range helper for "Label peaks", split out of usePeaks.ts
// (2026-09-14, audit P2.1) so that hook stays under its 500-line module
// ceiling — a pure, self-contained function with its own reasoning to carry,
// which is exactly what the ceiling asks to be extracted first.

/** A finite [lo, hi] from a value array, looping rather than
 *  `Math.min(...arr)` (a 100k+-point array blows the call-arity cap — see
 *  useBaseline.ts's own comment on the same hazard). Falls back to `[0, 1]`
 *  when nothing finite is present, so a degenerate/empty channel never
 *  produces a NaN range for `placeLabels`.
 *
 *  `positiveOnly` (P3 review finding, round 6): matches `lib/uplotOpts.ts`'s
 *  own `fullYExtents`/`isPositiveOnlyScale` convention — a log/reciprocal
 *  axis can only ever render (and therefore only ever legitimately span)
 *  POSITIVE values, so its floor must be the SMALLEST POSITIVE sample, not
 *  the channel's raw minimum. Without this, a single zero or slightly
 *  negative background sample — routine in real XRD data — made
 *  `finiteRange(y)[0] <= 0`, and `placeLabels`'s own transform then failed
 *  to establish a transformed range at all, silently reverting the WHOLE
 *  batch to linear offsets (the exact ~2.7-decade misplacement
 *  `peakLabels.test.ts`'s own log tests exist to prevent) — not an edge
 *  case, the COMMON case for real data. */
export function finiteRange(values: readonly number[], positiveOnly = false): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v) && (!positiveOnly || v > 0)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1];
}
