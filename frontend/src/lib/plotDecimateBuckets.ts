// The lazy-only half of plotDecimate.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the bucket-count rule and its two tuning constants. Only the lazy row bucketing reads them.
// The code moved here verbatim and plotDecimate.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.


/** Buckets per pixel column when decimation is engaged; min+max per bucket
 *  yields at most ~2 real samples per pixel column. */
export const DECIMATE_BUCKETS_PER_PX = 1;

/** Debounce window (ms) after the x scale stops changing before re-bucketing
 *  the newly-visible window — long enough that a live drag/wheel burst never
 *  triggers a rebucket mid-gesture, short enough to feel immediate once it does. */
export const DECIMATE_SETTLE_MS = 100;

export function bucketsForWidth(widthPx: number): number {
  return Math.max(1, Math.round(widthPx * DECIMATE_BUCKETS_PER_PX));
}
