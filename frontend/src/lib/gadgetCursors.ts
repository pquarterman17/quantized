// Paired-cursors gadget (gap #34): two draggable x-cursors + a Δx/Δy/slope
// readout against the first plotted channel's DATA. Nearest-x sample (not
// interpolated pointer position, unlike the "measure" tool's raw click y) —
// matches the cursor readout's own "value AT this sample" convention
// (uplotTools.readoutPlugin), and needs no assumption that x is sorted
// (hysteresis loops and other swept-back scans aren't). Reuses
// lib/measure's Measurement shape + Δx/Δy/slope math (no need to re-derive
// it) — only the "which y" lookup is new. The uPlot drag plugin
// (gadgetCursorsPlugin) lives in lib/uplotGadgets; this module is the
// testable pure core.

import { computeMeasurement, type Measurement } from "./measure";

/** The y of the finite (x,y) sample whose x is nearest `x`, or null when no
 *  finite sample exists. Nearest-x rather than interpolated, and does not
 *  require `xs` to be sorted. */
export function nearestY(xs: readonly number[], ys: readonly number[], x: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const xv = xs[i];
    const yv = ys[i];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    const d = Math.abs(xv - x);
    if (d < bestDist) {
      bestDist = d;
      best = yv;
    }
  }
  return best;
}

/** Build the two-cursor readout: Δx / Δy / slope between the nearest samples
 *  at each cursor's x (on `xs`/`ys` — the caller's first-visible-channel data).
 *  Null when either cursor has no data to snap to. */
export function computeCursorReadout(
  xs: readonly number[],
  ys: readonly number[],
  cursors: readonly [number, number],
): Measurement | null {
  const y0 = nearestY(xs, ys, cursors[0]);
  const y1 = nearestY(xs, ys, cursors[1]);
  if (y0 == null || y1 == null) return null;
  return computeMeasurement(cursors[0], y0, cursors[1], y1);
}
