// Peak Analyzer "add a peak here" (audit P2.4 slice 3, direct add): seed a
// new candidate's centre / height / FWHM from the data AROUND the x the user
// clicked or typed, instead of the flat "nearest point, 2 % of the range"
// guess the wizard used before. Pure.
//
// CENTRE. Snap to the highest point within a small window around the click
// (the larger of 2 points and 1.5 % of the points either side) — a click a
// few pixels off a peak lands on it. If that maximum sits on the window's
// EDGE, the trace is still climbing past the window: the click is on a
// slope or a shoulder, not near an apex, so the clicked x is kept (the
// user's intent — a hidden shoulder peak — beats the bigger neighbour).
//
// FWHM. The half-maximum rule of lib/peakwidth's `fwhm` (the FWHM tool), but
// anchored at THIS apex rather than at the highest point of a range: the
// local floor is the minimum within a wider window (the larger of 5 points
// and 10 % of the points either side), half = floor + (apex - floor) / 2,
// and each side walks out to its first sample below half, interpolating the
// crossing. A side that never crosses inside the window (a shoulder, the
// data edge) mirrors the other side; neither side -> 2 % of the x range. The
// result is capped at the x range.
//
// HEIGHT is the apex y in the coordinates given (the wizard passes its
// baseline-corrected working trace, and the candidate carries bg 0).

export interface ClickedPeakSeed {
  center: number;
  height: number;
  fwhm: number;
}

export function seedPeakNear(x: readonly number[], y: readonly number[], at: number): ClickedPeakSeed | null {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pts.push({ x: x[i], y: y[i] });
  }
  if (pts.length === 0 || !Number.isFinite(at)) return null;
  pts.sort((a, b) => a.x - b.x);
  const n = pts.length;
  const span = pts[n - 1].x - pts[0].x;
  const fallback = span / 50 || 1;

  let near = 0;
  for (let i = 1; i < n; i++) if (Math.abs(pts[i].x - at) < Math.abs(pts[near].x - at)) near = i;
  const w = Math.max(2, Math.round(n * 0.015));
  const lo = Math.max(0, near - w);
  const hi = Math.min(n - 1, near + w);
  let apex = near;
  for (let i = lo; i <= hi; i++) if (pts[i].y > pts[apex].y) apex = i;
  const snapped = apex === near || (apex > lo && apex < hi);
  if (!snapped) apex = near;
  const center = snapped ? pts[apex].x : at;
  const height = pts[apex].y;

  const W = Math.max(5, Math.round(n * 0.1));
  const from = Math.max(0, apex - W);
  const to = Math.min(n - 1, apex + W);
  let floor = height;
  for (let i = from; i <= to; i++) floor = Math.min(floor, pts[i].y);
  if (!(height > floor)) return { center, height, fwhm: fallback };
  const half = floor + (height - floor) / 2;
  const cross = (i: number, j: number): number => {
    const a = pts[i];
    const b = pts[j];
    return a.y === b.y ? a.x : a.x + ((b.x - a.x) * (half - a.y)) / (b.y - a.y);
  };
  let left: number | null = null;
  for (let i = apex; i > from; i--) {
    if (pts[i - 1].y < half) {
      left = pts[apex].x - cross(i - 1, i);
      break;
    }
  }
  let right: number | null = null;
  for (let i = apex; i < to; i++) {
    if (pts[i + 1].y < half) {
      right = cross(i, i + 1) - pts[apex].x;
      break;
    }
  }
  const width = left !== null && right !== null ? left + right : 2 * (left ?? right ?? fallback / 2);
  return { center, height, fwhm: Math.min(width > 0 ? width : fallback, span || width) };
}
