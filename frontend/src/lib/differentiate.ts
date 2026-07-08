// Differentiate gadget (gap #34): client-side numerical derivative over an
// ROI-selected region. Pure math only — the gadget store slice feeds it
// ROI∩analysisData rows from lib/quickfit.selectRoiRows (which returns x/y/rows
// in original row order, not sorted — hysteresis loops and other swept-back
// scans are non-monotonic). No uPlot / React / store imports here.

/** Ascending-by-x sort of parallel (x, y) arrays. Central differences require
 *  monotonic x; ROI row selections arrive in acquisition order. Returns new
 *  arrays (input is never mutated). */
export function sortByX(
  x: readonly number[],
  y: readonly number[],
): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
  return { x: order.map((i) => x[i]), y: order.map((i) => y[i]) };
}

export interface DerivativeResult {
  /** dy/dx aligned 1:1 with the CALLER's input (x, y) order — not sorted — so
   *  it can be handed straight to rowstate.expandToFull against the caller's
   *  own row indices. */
  dydx: number[];
  /** The x at the sample with the largest |dy/dx| — the chip's headline value. */
  extremumX: number;
  extremumDydx: number;
}

/** Non-uniform-spacing central difference (the same weighted formula MATLAB's
 *  `gradient` uses): forward/backward difference at the two endpoints, a
 *  spacing-weighted central difference elsewhere. `x`/`y` need not be sorted —
 *  they are sorted internally, and the result is handed back un-permuted to
 *  the caller's original order. Returns null for fewer than 2 points. A
 *  degenerate spacing (duplicate x) yields NaN at that sample rather than
 *  ±Infinity. */
export function centralDifference(
  x: readonly number[],
  y: readonly number[],
): DerivativeResult | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]);
  const ys = order.map((i) => y[i]);

  const sortedDydx: number[] = new Array(n);
  for (let k = 0; k < n; k++) {
    if (k === 0) {
      const h = xs[1] - xs[0];
      sortedDydx[k] = h !== 0 ? (ys[1] - ys[0]) / h : NaN;
    } else if (k === n - 1) {
      const h = xs[n - 1] - xs[n - 2];
      sortedDydx[k] = h !== 0 ? (ys[n - 1] - ys[n - 2]) / h : NaN;
    } else {
      const h1 = xs[k] - xs[k - 1];
      const h2 = xs[k + 1] - xs[k];
      const denom = h1 * h2 * (h1 + h2);
      sortedDydx[k] =
        denom !== 0
          ? (h1 ** 2 * ys[k + 1] + (h2 ** 2 - h1 ** 2) * ys[k] - h2 ** 2 * ys[k - 1]) / denom
          : NaN;
    }
  }

  // Un-permute back to the caller's original (x, y) order.
  const dydx: number[] = new Array(n);
  for (let k = 0; k < n; k++) dydx[order[k]] = sortedDydx[k];

  let extremumK = 0;
  let extremumAbs = -Infinity;
  for (let k = 0; k < n; k++) {
    const a = Math.abs(sortedDydx[k]);
    if (Number.isFinite(a) && a > extremumAbs) {
      extremumAbs = a;
      extremumK = k;
    }
  }
  return { dydx, extremumX: xs[extremumK], extremumDydx: sortedDydx[extremumK] };
}
