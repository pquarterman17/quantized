// Trapezoidal area under a trace over an x-range, for the on-plot Integrate tool
// (∫). Pure + unit-tested. Each consecutive segment is clipped to [xlo,xhi] with
// the y values linearly interpolated at the boundaries (so the ends aren't
// snapped to the nearest sample). Null/non-finite endpoints drop that segment.
// The result is ∫ y dx relative to y = 0 (signed: y < 0 subtracts) — distinct
// from the filled-to-baseline drawing, which is only illustrative.

/** Signed trapezoidal integral of (x, y) over [xlo, xhi]. Order of xlo/xhi is
 *  irrelevant (normalised). Returns 0 when nothing overlaps the range. */
export function trapz(
  x: readonly (number | null)[],
  y: readonly (number | null)[],
  xlo: number,
  xhi: number,
): number {
  const lo = Math.min(xlo, xhi);
  const hi = Math.max(xlo, xhi);
  const n = Math.min(x.length, y.length);
  let area = 0;
  for (let i = 0; i + 1 < n; i++) {
    const xa = x[i];
    const xb = x[i + 1];
    const ya = y[i];
    const yb = y[i + 1];
    if (xa == null || xb == null || ya == null || yb == null) continue;
    if (!Number.isFinite(xa) || !Number.isFinite(xb) || !Number.isFinite(ya) || !Number.isFinite(yb)) {
      continue;
    }
    // The segment's x-span (handles ascending or descending point order).
    const segLo = Math.min(xa, xb);
    const segHi = Math.max(xa, xb);
    const clipLo = Math.max(segLo, lo);
    const clipHi = Math.min(segHi, hi);
    if (clipHi <= clipLo) continue; // no overlap with the range
    // Linear y at a clip boundary along this segment.
    const interp = (xx: number): number => (xa === xb ? ya : ya + ((yb - ya) * (xx - xa)) / (xb - xa));
    area += ((interp(clipLo) + interp(clipHi)) / 2) * (clipHi - clipLo);
  }
  return area;
}
