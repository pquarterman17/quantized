// Pure range math for the baseline "Fit from region" rubber-band selection.
// The plot's pixel→data conversion is delegated to uPlot's own `posToVal`
// (handles linear + log x); the only framework-independent logic worth testing
// lives here: turn a drag's two data-x endpoints into an ordered, clamped
// [x_min, x_max] window, rejecting a zero-span click.

/** Bounds to clamp a selected range into (typically the data's x-extent). */
export interface RangeBounds {
  min?: number;
  max?: number;
}

/**
 * Normalize a drag's two data-x endpoints to an ordered, clamped range.
 *
 * - Orders the endpoints so the result is always `[lo, hi]` with `lo <= hi`,
 *   regardless of drag direction.
 * - Clamps both edges into `bounds` (when given) so a drag that runs off the
 *   plot edge is pinned to the data extent.
 * - Returns `null` for a degenerate selection (non-finite input, or a span
 *   that collapses to a point after clamping) so callers can ignore a click.
 */
export function normalizeRange(
  a: number,
  b: number,
  bounds?: RangeBounds,
): [number, number] | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  if (bounds) {
    const { min, max } = bounds;
    if (min != null) {
      lo = Math.max(lo, min);
      hi = Math.max(hi, min);
    }
    if (max != null) {
      lo = Math.min(lo, max);
      hi = Math.min(hi, max);
    }
  }
  if (!(lo < hi)) return null; // collapsed to a point (or fully outside bounds)
  return [lo, hi];
}
