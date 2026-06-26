// Pure transforms for the polar plot mode (x = angle in degrees -> theta,
// y = value -> radius). The Canvas2D drawing lives in PolarStage; these are the
// testable core.

/** (theta degrees, normalized radius 0..1) -> canvas pixel. 0° points east (+x)
 *  and angle increases counter-clockwise; canvas y grows downward, so the sine
 *  term is negated to keep 90° pointing up. */
export function polarToXY(
  thetaDeg: number,
  rNorm: number,
  cx: number,
  cy: number,
  radius: number,
): [number, number] {
  const a = (thetaDeg * Math.PI) / 180;
  const rr = rNorm * radius;
  return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
}

/** Normalize a value to [0,1] over [vmin, vmax] (clamped; 0 for a degenerate
 *  range or non-finite input). Maps vmin to the centre, vmax to the rim, so
 *  signed data (e.g. moment) plots without negative radii. */
export function radiusNorm(v: number, vmin: number, vmax: number): number {
  if (vmax <= vmin || !Number.isFinite(v)) return 0;
  const t = (v - vmin) / (vmax - vmin);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
