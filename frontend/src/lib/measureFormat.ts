// The lazy-only half of lib/measure.ts (bundle diet, plans/BUNDLE_HEADROOM.md
// slice 34): the readout text for a finished measurement. Only the lazy plot
// readout chips print it, so the code moved here verbatim and lib/measure.ts
// re-exports it with `export *` - importers and tests are unchanged, and
// Rollup bundles this file with the lazy chunks that use it.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import type { Measurement } from "./measure";

/** Compact, monospace-friendly number: sci notation for very large/small
 *  magnitudes, else 4 significant figures. */
function num(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const mag = Math.abs(v);
  return mag >= 1e5 || mag < 1e-3 ? v.toExponential(2) : v.toPrecision(4);
}

/** Format a measurement for the readout chip: "Δx … Δy … slope …". */
export function formatMeasurement(m: Measurement): string {
  const slope = m.slope == null ? "∞ (vertical)" : num(m.slope);
  return `Δx ${num(m.dx)}   Δy ${num(m.dy)}   slope ${slope}`;
}
