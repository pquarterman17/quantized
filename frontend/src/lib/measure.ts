// Pure geometry for the plot measurement tool: the user drags from point A to
// point B and we report Δx, Δy, and the slope between them. Stored in DATA
// coordinates (not pixels) so the segment stays pinned to the data across
// zoom/pan. The canvas drawing + pointer plumbing live in uplotTools
// (measurePlugin); this module is the testable core.

export interface Measurement {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  /** dy/dx, or null for a vertical segment (dx === 0). */
  slope: number | null;
}

/** Build a Measurement from the two endpoints (A → B), in data coordinates. */
export function computeMeasurement(x0: number, y0: number, x1: number, y1: number): Measurement {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return { x0, y0, x1, y1, dx, dy, slope: dx === 0 ? null : dy / dx };
}

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
