// Natural cubic spline for the "Spline" line connect (gap audit 3, N6) — the
// canvas half of `calc/figure_marks.py`'s `spline_dense` (scipy CubicSpline,
// bc_type="natural"), SUBSTEPS samples per segment, so the exported figure
// draws the same curve the Stage does.
//
// Only where X is strictly ascending over the finite rows: a hysteresis loop or
// a repeated X is not a function of X, so `splineDense` answers null and the
// caller draws straight segments in row order instead (never resorted).

import type { DataStruct } from "./types";

/** Samples per segment — `calc/figure_marks.SUBSTEPS`. */
export const SUBSTEPS = 16;

type Cell = number | null | undefined;

const finite = (v: Cell): v is number => v != null && Number.isFinite(v);

/** The finite (x, y) rows are >= 3 and X is strictly ascending over them. */
export function splineEligible(xs: readonly Cell[], ys: readonly Cell[]): boolean {
  let n = 0;
  let prev = -Infinity;
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    if (!finite(x) || !finite(ys[i])) continue;
    if (x <= prev) return false;
    prev = x;
    n++;
  }
  return n >= 3;
}

/** Second derivatives of the natural spline through (x, y) (Thomas algorithm). */
function secondDerivs(x: number[], y: number[]): number[] {
  const n = x.length;
  const m = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = x[i] - x[i - 1];
    const h1 = x[i + 1] - x[i];
    const diag = 2 * (h0 + h1) - (i > 1 ? (h0 * c[i - 1]) : 0);
    c[i] = h1 / diag;
    const rhs = 6 * ((y[i + 1] - y[i]) / h1 - (y[i] - y[i - 1]) / h0);
    d[i] = (rhs - (i > 1 ? h0 * d[i - 1] : 0)) / diag;
  }
  for (let i = n - 2; i >= 1; i--) m[i] = d[i] - c[i] * m[i + 1];
  return m;
}

function runDense(x: number[], y: number[]): { x: number[]; y: number[]; knots: number[] } {
  if (x.length < 3) return { x, y, knots: x.map((_, i) => i) }; // too short for a cubic: straight
  const m = secondDerivs(x, y);
  const ox: number[] = [];
  const oy: number[] = [];
  const knots: number[] = [];
  for (let i = 0; i < x.length - 1; i++) {
    const h = x[i + 1] - x[i];
    knots.push(ox.length);
    for (let k = 0; k < SUBSTEPS; k++) {
      const t = x[i] + (h * k) / SUBSTEPS;
      const a = x[i + 1] - t;
      const b = t - x[i];
      ox.push(t);
      oy.push(
        (m[i] * a ** 3) / (6 * h) + (m[i + 1] * b ** 3) / (6 * h) +
          (y[i] / h - (m[i] * h) / 6) * a + (y[i + 1] / h - (m[i + 1] * h) / 6) * b,
      );
    }
  }
  knots.push(ox.length);
  ox.push(x[x.length - 1]);
  oy.push(y[y.length - 1]);
  return { x: ox, y: oy, knots };
}

/** The spline-connected curve, or null when it cannot be drawn (see
 *  `splineEligible`). A non-finite row ends a run; each run is splined alone
 *  and the runs are joined by one NaN row so the line breaks there. */
export function splineDense(
  xs: readonly Cell[],
  ys: readonly Cell[],
): { x: number[]; y: number[]; knots: number[] } | null {
  if (!splineEligible(xs, ys)) return null;
  const n = Math.min(xs.length, ys.length);
  const out = { x: [] as number[], y: [] as number[], knots: [] as number[] };
  let i = 0;
  while (i < n) {
    if (!finite(xs[i]) || !finite(ys[i])) { i++; continue; }
    let j = i;
    while (j + 1 < n && finite(xs[j + 1]) && finite(ys[j + 1])) j++;
    const run = runDense(xs.slice(i, j + 1) as number[], ys.slice(i, j + 1) as number[]);
    if (out.x.length) { out.x.push(NaN); out.y.push(NaN); }
    const off = out.x.length;
    for (const k of run.knots) out.knots.push(off + k);
    out.x.push(...run.x);
    out.y.push(...run.y);
    i = j + 1;
  }
  return out;
}

/** Whether `channel`'s spline connect can be drawn against `xKey` (the
 *  Inspector's "drawn straight" notice) — `splineEligible` over the dataset. */
export function channelSplineEligible(ds: DataStruct, xKey: number | null, channel: number): boolean {
  const xs = xKey == null ? ds.time : ds.values.map((r) => r[xKey]);
  return splineEligible(xs, ds.values.map((r) => r[channel]));
}
