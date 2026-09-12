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

/**
 * A rubber-band's normalized pick: the x window — same shape and semantics
 * as `normalizeRange`'s return, untouched by this addition — plus an
 * optional y window from a genuine 2-D drag (MATLAB `onBGMouseUp` parity:
 * the box masks points outside BOTH ranges).
 *
 * `yRange` is *omitted*, never `null`, when the drag carried no y span (or
 * an older caller never supplied one): a request body can spread `yRange`
 * straight into `y_min`/`y_max` and an x-only pick sends exactly what it
 * always sent, byte-identical.
 */
export interface RegionPick {
  x: [number, number];
  yRange?: [number, number];
}

/**
 * Attach an optional y window to an already-normalized x window, producing
 * the `RegionPick` the baseline workshop consumes.
 *
 * `y0`/`y1` are normalized with the exact same order/clamp/degenerate rules
 * as the x window — `normalizeRange` itself, reused unchanged — so an
 * inverted y drag is reordered just like x always was, and a degenerate or
 * fully-out-of-bounds y span drops `yRange` rather than smuggling in a
 * point. `y0`/`y1` missing (an x-only drag, or an older call site that never
 * measured y at all) leaves `yRange` off too: same result either way, which
 * is what makes "no y" byte-identical to every pick before this existed.
 */
export function withYRange(
  x: [number, number],
  y0?: number,
  y1?: number,
  yBounds?: RangeBounds,
): RegionPick {
  if (y0 == null || y1 == null) return { x };
  const yRange = normalizeRange(y0, y1, yBounds);
  return yRange ? { x, yRange } : { x };
}
