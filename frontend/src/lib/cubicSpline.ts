// Natural cubic spline for the "Spline" line connect (gap audit 3, N6) — the
// canvas half of `calc/figure_marks.py`'s `spline_dense` (scipy CubicSpline,
// bc_type="natural"), SUBSTEPS samples per segment, so the exported figure
// draws the same curve the Stage does.
//
// Only where X is strictly ascending over the finite rows AND there are at most
// SPLINE_MAX_ROWS of them: a hysteresis loop or a repeated X is not a function
// of X, and past the cap the rows are denser than the pixels. `splineDense` then
// answers null and the caller draws straight segments in row order (never resorted).

import { SPLINE_MAX_ROWS } from "./marksLoader";
import type { DataStruct } from "./types";

/** Samples per segment — `calc/figure_marks.SUBSTEPS`. */
export const SUBSTEPS = 16;

type Cell = number | null | undefined;

const finite = (v: Cell): v is number => v != null && Number.isFinite(v);

/** Why a spline cannot be drawn for these rows, or null when it can. */
export function splineRefusal(xs: readonly Cell[], ys: readonly Cell[]): "loop" | "long" | "short" | null {
  let n = 0;
  let prev = -Infinity;
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    if (!finite(x) || !finite(ys[i])) continue;
    if (x <= prev) return "loop";
    prev = x;
    n++;
  }
  return n > SPLINE_MAX_ROWS ? "long" : n < 3 ? "short" : null;
}

export const splineEligible = (xs: readonly Cell[], ys: readonly Cell[]): boolean => splineRefusal(xs, ys) === null;

/** Second derivatives of the natural spline through (x, y) (Thomas algorithm). */
function secondDerivs(x: Cell[], y: Cell[], a: number, n: number): Float64Array {
  const m = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = (x[a + i] as number) - (x[a + i - 1] as number);
    const h1 = (x[a + i + 1] as number) - (x[a + i] as number);
    const diag = 2 * (h0 + h1) - (i > 1 ? h0 * c[i - 1] : 0);
    c[i] = h1 / diag;
    const rhs = 6 * (((y[a + i + 1] as number) - (y[a + i] as number)) / h1 - ((y[a + i] as number) - (y[a + i - 1] as number)) / h0);
    d[i] = (rhs - (i > 1 ? h0 * d[i - 1] : 0)) / diag;
  }
  for (let i = n - 2; i >= 1; i--) m[i] = d[i] - c[i] * m[i + 1];
  return m;
}

export interface Dense { x: Float64Array; y: Float64Array; knots: number[] }

/** The spline-connected curve, or null when it cannot be drawn (see
 *  `splineRefusal`). A non-finite row ends a run; each run is splined alone and
 *  the runs are joined by one NaN row so the line breaks there. Preallocated
 *  typed arrays throughout (no spread pushes: a long series must not overflow
 *  the call stack). */
export function splineDense(xs: readonly Cell[], ys: readonly Cell[]): Dense | null {
  if (splineRefusal(xs, ys) !== null) return null;
  const n = Math.min(xs.length, ys.length);
  const runs: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (!finite(xs[i]) || !finite(ys[i])) { i++; continue; }
    let j = i;
    while (j + 1 < n && finite(xs[j + 1]) && finite(ys[j + 1])) j++;
    runs.push([i, j - i + 1]);
    i = j + 1;
  }
  let total = runs.length - 1;
  for (const [, len] of runs) total += len < 3 ? len : (len - 1) * SUBSTEPS + 1;
  const ox = new Float64Array(total);
  const oy = new Float64Array(total);
  const knots: number[] = [];
  let o = 0;
  runs.forEach(([a, len], r) => {
    if (r > 0) { ox[o] = NaN; oy[o] = NaN; o++; }
    if (len < 3) { // too short for a cubic: straight
      for (let k = 0; k < len; k++, o++) { knots.push(o); ox[o] = xs[a + k] as number; oy[o] = ys[a + k] as number; }
      return;
    }
    const m = secondDerivs(xs as Cell[], ys as Cell[], a, len);
    for (let i = 0; i < len - 1; i++) {
      const x0 = xs[a + i] as number;
      const h = (xs[a + i + 1] as number) - x0;
      const y0 = ys[a + i] as number;
      const y1 = ys[a + i + 1] as number;
      const p = y0 / h - (m[i] * h) / 6;
      const q = y1 / h - (m[i + 1] * h) / 6;
      knots.push(o);
      for (let k = 0; k < SUBSTEPS; k++, o++) {
        const t = x0 + (h * k) / SUBSTEPS;
        const u = (xs[a + i + 1] as number) - t;
        const v = t - x0;
        ox[o] = t;
        oy[o] = (m[i] * u ** 3) / (6 * h) + (m[i + 1] * v ** 3) / (6 * h) + p * u + q * v;
      }
    }
    knots.push(o);
    ox[o] = xs[a + len - 1] as number;
    oy[o] = ys[a + len - 1] as number;
    o++;
  });
  return { x: ox, y: oy, knots };
}

const cache = new WeakMap<object, { xs: object; dense: Dense | null }>();

/** `splineDense`, remembered per data identity (the y array, checked against its x array): a redraw
 *  on every zoom or pan reuses the curve instead of refitting it. */
export function splineDenseCached(xs: readonly Cell[], ys: readonly Cell[]): Dense | null {
  const hit = cache.get(ys);
  if (hit && hit.xs === xs) return hit.dense;
  const dense = splineDense(xs, ys);
  cache.set(ys, { xs, dense });
  return dense;
}

/** Why `channel`'s spline connect would be drawn straight against `xKey`, or null (the Inspector notice). */
export function channelSplineRefusal(ds: DataStruct, xKey: number | null, channel: number) {
  const xs = xKey == null ? ds.time : ds.values.map((r) => r[xKey]);
  return splineRefusal(xs, ds.values.map((r) => r[channel]));
}
