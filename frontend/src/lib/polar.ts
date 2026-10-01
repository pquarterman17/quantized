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

/** The canvas' angular convention, as the polar export wire spells it
 *  (`routes/export_figures_polar.PolarFigureSpec`): the angle column is in
 *  degrees, increases counter-clockwise, and 0 sits east — exactly what
 *  `polarToXY` above draws. Sent verbatim on every polar export so the
 *  renderer never assumes it. */
export const POLAR_CANVAS = { theta_unit: "deg", theta_direction: "ccw", theta_zero: "E" } as const;

/** The channels the polar view draws: `yKeys`, or every channel. No hidden or
 *  X-channel filtering — the canvas has none. */
export function polarChannels(yKeys: readonly number[] | null, nChannels: number): number[] {
  return yKeys ? [...yKeys] : Array.from({ length: nChannels }, (_, i) => i);
}

/** The shared radial range every plotted channel is drawn against: [min, max]
 *  of the finite values (min at the centre), or [0, 1] when there are none or
 *  the range is degenerate. ONE rule for the canvas (`PolarStageCore`) and the
 *  export (`lib/polarFigureSpec.ts`). */
export function polarRadialRange(
  values: readonly (readonly number[])[],
  channels: readonly number[],
): [number, number] {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const ch of channels) {
    for (const row of values) {
      const v = row[ch];
      if (Number.isFinite(v)) {
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
  }
  return !Number.isFinite(vmin) || vmax <= vmin ? [0, 1] : [vmin, vmax];
}
