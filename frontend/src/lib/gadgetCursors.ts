// Paired-cursors gadget (gap #34): two draggable x-cursors + a Δx/Δy/slope
// readout against the first plotted channel's DATA. Nearest-x sample, printed
// with the SAMPLE's own x (not interpolated, unlike the "measure" tool's raw click y) —
// matches the cursor readout's own "value AT this sample" convention
// (uplotTools.readoutPlugin), and needs no assumption that x is sorted
// (hysteresis loops and other swept-back scans aren't). Reuses
// lib/measure's Measurement shape + Δx/Δy/slope math (no need to re-derive
// it) — only the "which y" lookup is new. The uPlot drag plugin
// (gadgetCursorsPlugin) lives in lib/uplotGadgets; this module is the
// testable pure core.

import { computeMeasurement, type Measurement } from "./measure";

/** The finite (x, y) sample whose x is nearest `x`, or null when none exists.
 *  Nearest-x rather than interpolated, and does not require `xs` to be sorted.
 *  The pair is ONE sample: its own x with its own y, never the cursor's x. */
export function nearestSample(xs: readonly number[], ys: readonly number[], x: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(xs[i] - x);
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i]) && d < bestDist) {
      bestDist = d;
      best = { x: xs[i], y: ys[i] };
    }
  }
  return best;
}

/** The y of the nearest finite sample (see `nearestSample`). */
export const nearestY = (xs: readonly number[], ys: readonly number[], x: number): number | null =>
  nearestSample(xs, ys, x)?.y ?? null;

/** Build the two-cursor readout: Δx / Δy / slope between the nearest SAMPLES to
 *  each cursor (on `xs`/`ys` — the caller's first-visible-channel data). Every
 *  printed point is one sample's own (x, y), and Δ and slope come from those
 *  pairs, so the readout is self-consistent (a cursor between samples is not
 *  paired with a neighbour's y). Null when either cursor has no data to snap to. */
export function computeCursorReadout(
  xs: readonly number[],
  ys: readonly number[],
  cursors: readonly [number, number],
): Measurement | null {
  const a = nearestSample(xs, ys, cursors[0]);
  const b = nearestSample(xs, ys, cursors[1]);
  if (!a || !b) return null;
  return computeMeasurement(a.x, a.y, b.x, b.y);
}
