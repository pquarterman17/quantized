// Quick on-plot peak + full-width-half-max estimator for the FWHM tool (∩). Pure
// + unit-tested. This is the eyeball estimator — the model-based Curve-fit
// workshop stays the source of truth for fitted widths.
//
// Within [xlo,xhi]: peak = max y, baseline = min y, half = baseline + (peak −
// baseline)/2. Walk left and right from the peak to the first half-max crossing,
// interpolating the crossing x; FWHM = x2 − x1. Points are sorted by x first so a
// non-monotonic trace (swept-back scan) still yields a sensible left/right walk.

export interface FwhmResult {
  /** x of the peak apex. */
  center: number;
  /** y at the apex (max). */
  height: number;
  /** min y in the range (the local baseline). */
  baseline: number;
  /** the half-max level. */
  half: number;
  /** left half-max crossing x. */
  x1: number;
  /** right half-max crossing x. */
  x2: number;
  /** x2 − x1. */
  fwhm: number;
}

/** Estimate peak + FWHM over [xlo,xhi], or null if fewer than 2 finite points or
 *  a degenerate (flat) range. */
export function fwhm(
  x: readonly (number | null)[],
  y: readonly (number | null)[],
  xlo: number,
  xhi: number,
): FwhmResult | null {
  const lo = Math.min(xlo, xhi);
  const hi = Math.max(xlo, xhi);
  const n = Math.min(x.length, y.length);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi == null || yi == null || !Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    if (xi >= lo && xi <= hi) pts.push({ x: xi, y: yi });
  }
  if (pts.length < 2) return null;
  pts.sort((a, b) => a.x - b.x);

  let peak = 0;
  let baseline = pts[0].y;
  let height = pts[0].y;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].y > pts[peak].y) peak = i;
    if (pts[i].y < baseline) baseline = pts[i].y;
    if (pts[i].y > height) height = pts[i].y;
  }
  if (height <= baseline) return null; // flat — no peak
  const half = baseline + (height - baseline) / 2;
  const center = pts[peak].x;

  // Interpolated x where the segment [i, i+1] crosses `half`.
  const cross = (i: number, j: number): number => {
    const a = pts[i];
    const b = pts[j];
    if (a.y === b.y) return a.x;
    return a.x + ((b.x - a.x) * (half - a.y)) / (b.y - a.y);
  };

  // Walk left: first point below half → interpolate between it and its inner
  // neighbour; if none, clamp to the leftmost x.
  let x1 = pts[0].x;
  for (let i = peak; i > 0; i--) {
    if (pts[i - 1].y < half) {
      x1 = cross(i - 1, i);
      break;
    }
  }
  // Walk right.
  let x2 = pts[pts.length - 1].x;
  for (let i = peak; i < pts.length - 1; i++) {
    if (pts[i + 1].y < half) {
      x2 = cross(i, i + 1);
      break;
    }
  }
  return { center, height, baseline, half, x1, x2, fwhm: x2 - x1 };
}
