// Pure helper for the magnifier inset: the default x sub-range it opens on.

/** The centred sub-range covering `fraction` of [min, max] (0<fraction<=1).
 *  Used to seed the inset with a magnified view; returns [min, max] for a
 *  degenerate span or a fraction >= 1. */
export function centralRange(min: number, max: number, fraction = 0.3): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min, max];
  const f = Math.min(Math.max(fraction, 0), 1);
  if (f >= 1) return [min, max];
  const mid = (min + max) / 2;
  const half = ((max - min) * f) / 2;
  return [mid - half, mid + half];
}
