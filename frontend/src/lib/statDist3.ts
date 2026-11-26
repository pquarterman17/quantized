// Half / split violin, paired before-after, lollipop and stacked-histogram
// vertices (plan item 20). Each builder mirrors its Python twin
// (`calc/statplots_sideviolin.py`, `statplots_paired.py`, `statplots_lollipop.py`,
// `statplots_stack.py`), which the matplotlib export draws; the canvas maps the
// same vertices to pixels, and `tests/fixtures/wire/stat_{sideviolin,paired,
// lollipop,stackhist}.json` pin the two (`Stage/statDist3Parity.test.ts`,
// `tests/test_stat_dist3.py`). Conventions are stated once, in the Python
// modules. Lazy only (the Stat Stage).

import type { RidgelineWire } from "./statRidgeline";
import { tCritical95 } from "./tdist";

export const SIDE_HALF_WIDTH = 0.45;
export type Pt = [number, number];
export type SideViolinStyle = "half" | "split";
export type Side = "left" | "right";
export type LollipopStat = "mean" | "median";
export type LollipopSort = "none" | "asc" | "desc";

// ── half / split violin ────────────────────────────────────────────────────
export interface SideViolinGeometry {
  x_domain: [number, number];
  y_domain: [number, number];
  slots: number;
  violins: { slot: number; side: Side; color: number; fill: Pt[]; line: Pt[] }[];
}

export function sideViolinGeometry(
  r: RidgelineWire,
  slots: readonly number[],
  sides: readonly Side[],
  style: SideViolinStyle,
): SideViolinGeometry {
  const scale = SIDE_HALF_WIDTH / r.d_max;
  const m = slots.length ? Math.max(...slots) + 1 : 0;
  const violins = r.groups.map((g, k) => {
    const p = slots[k];
    const sign = sides[k] === "left" ? -1 : 1;
    const line = g.x.map((x, i): Pt => [p + sign * g.density[i] * scale, x]);
    const fill: Pt[] = [[p, line[0][1]], ...line, [p, line[line.length - 1][1]]];
    const color = style === "split" ? (sides[k] === "left" ? 0 : 1) : p;
    return { slot: p, side: sides[k], color, fill, line };
  });
  return { x_domain: [-0.5, m - 0.5], y_domain: r.domain, slots: m, violins };
}

// ── paired ─────────────────────────────────────────────────────────────────
export interface PairedSeries {
  n: number;
  before: number[];
  after: number[];
  sides: { mean: number; lo: number; hi: number }[];
}
export interface PairedGeometry {
  x_domain: [number, number];
  y_domain: [number, number];
  lines: [Pt, Pt][];
  before: Pt[];
  after: Pt[];
  means: { x: number; mean: number; lo: number; hi: number }[];
}

/** The complete pairs and each side's mean and 95 % CI; throws below 2 pairs. */
export function pairedSeries(before: readonly number[], after: readonly number[]): PairedSeries {
  if (before.length !== after.length) throw new Error("before and after need the same number of rows");
  const b: number[] = [];
  const a: number[] = [];
  before.forEach((v, i) => {
    if (Number.isFinite(v) && Number.isFinite(after[i])) {
      b.push(v);
      a.push(after[i]);
    }
  });
  const n = b.length;
  if (n < 2) throw new Error("a paired plot needs at least 2 rows with both values finite");
  const t = tCritical95(n - 1);
  const sides = [b, a].map((v) => {
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    const half = (t * sd) / Math.sqrt(n);
    return { mean, lo: mean - half, hi: mean + half };
  });
  return { n, before: b, after: a, sides };
}

/** The 5 % padded range of `values` (`statplots_cdf.padded_domain`). */
export function paddedDomain(values: readonly number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi > lo ? 0.05 * (hi - lo) : 0.5;
  return [lo - pad, hi + pad];
}

export function pairedGeometry(r: PairedSeries, ci: boolean): PairedGeometry {
  const values = [...r.before, ...r.after];
  const means = ci ? r.sides.map((s, x) => ({ x, ...s })) : [];
  for (const m of means) values.push(m.lo, m.hi);
  return {
    x_domain: [-0.5, 1.5],
    y_domain: paddedDomain(values),
    lines: r.before.map((u, i): [Pt, Pt] => [[0, u], [1, r.after[i]]]),
    before: r.before.map((u): Pt => [0, u]),
    after: r.after.map((v): Pt => [1, v]),
    means: means.map((m) => ({ x: m.x, mean: m.mean, lo: m.lo, hi: m.hi })),
  };
}

// ── lollipop ───────────────────────────────────────────────────────────────
export interface LollipopSeries {
  stat: LollipopStat;
  sort: LollipopSort;
  values: number[];
  n: number[];
  order: number[];
}
export interface LollipopGeometry {
  x_domain: [number, number];
  y_domain: [number, number];
  stems: [Pt, Pt][];
  dots: Pt[];
}

function median(v: readonly number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

export function lollipopSeries(groups: readonly (readonly number[])[], stat: LollipopStat, sort: LollipopSort): LollipopSeries {
  const values: number[] = [];
  const n: number[] = [];
  groups.forEach((g, i) => {
    const v = g.filter((x) => Number.isFinite(x));
    if (!v.length) throw new Error(`group ${i + 1} has no finite value`);
    values.push(stat === "mean" ? v.reduce((s, x) => s + x, 0) / v.length : median(v));
    n.push(v.length);
  });
  const order = values.map((_, i) => i);
  // Array.prototype.sort is stable, so ties keep the groups' own order (as in Python).
  if (sort !== "none") order.sort((i, j) => (sort === "desc" ? values[j] - values[i] : values[i] - values[j]));
  return { stat, sort, values, n, order };
}

export function lollipopGeometry(r: LollipopSeries): LollipopGeometry {
  const vals = r.order.map((i) => r.values[i]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = hi > lo ? 0.05 * (hi - lo) : 1;
  return {
    x_domain: [-0.5, vals.length - 0.5],
    y_domain: [lo - pad, hi + pad],
    stems: vals.map((v, k): [Pt, Pt] => [[k, 0], [k, v]]),
    dots: vals.map((v, k): Pt => [k, v]),
  };
}

// ── stacked histogram ──────────────────────────────────────────────────────
export interface StackGeometry {
  edges: number[];
  /** Per series, per bin: `[x0, x1, base, top]`. */
  bars: [number, number, number, number][][];
  y_max: number;
}

export function stackGeometry(edges: readonly number[], counts: readonly (readonly number[])[]): StackGeometry {
  const running = new Array<number>(edges.length - 1).fill(0);
  const bars = counts.map((row) =>
    row.map((c, i): [number, number, number, number] => {
      const bar: [number, number, number, number] = [edges[i], edges[i + 1], running[i], running[i] + c];
      running[i] += c;
      return bar;
    }),
  );
  return { edges: [...edges], bars, y_max: Math.max(...running) };
}
