// Half / split violin, paired before-after, lollipop and stacked-histogram
// vertices (plan item 20). Each builder mirrors its Python twin
// (`calc/statplots_sideviolin.py`, `statplots_paired.py`, `statplots_lollipop.py`,
// `statplots_stack.py`), which the matplotlib export draws; the canvas maps the
// same vertices to pixels, and `tests/fixtures/wire/stat_{sideviolin,paired,
// lollipop,stackhist}.json` pin the two (`Stage/statDist3Parity.test.ts`,
// `tests/test_stat_dist3.py`). Conventions are stated once, in the Python
// modules. Lazy only (the Stat Stage).

import type { RidgelineWire } from "./statRidgeline";
import { percentileLinear } from "./statstage";
import { tCritical95 } from "./tdist";

export const SIDE_HALF_WIDTH = 0.45;
export type Pt = [number, number];
export type SideViolinStyle = "half" | "split";
export type Side = "left" | "right";
export type LollipopStat = "mean" | "median";
export type LollipopSort = "none" | "asc" | "desc";
export type ViolinMarks = "none" | "median" | "quartiles" | "both";
export type PairDirection = "up" | "down" | "same";
const MARK_NAMES: Record<ViolinMarks, string[]> = { none: [], median: ["median"], quartiles: ["q1", "q3"], both: ["q1", "median", "q3"] };
const DIRECTIONS: PairDirection[] = ["up", "down", "same"];
const DIRECTION_LABELS = ["increase", "decrease", "no change"];

// ── half / split violin ────────────────────────────────────────────────────
export interface SideViolinGeometry {
  x_domain: [number, number];
  y_domain: [number, number];
  slots: number;
  violins: { slot: number; side: Side; color: number; fill: Pt[]; line: Pt[]; marks?: ViolinMark[] }[];
}
/** One inner mark: a horizontal segment at `y` from the axis (`x[0]`) to the outline (`x[1]`). */
export interface ViolinMark {
  name: string;
  y: number;
  x: [number, number];
}

/** The inner marks of one violin (`statplots_vmarks.mark_segments`): numpy's linear quartiles,
 *  the density linearly interpolated on the KDE grid. */
function markSegments(g: { x: number[]; density: number[] }, values: readonly number[], p: number, sign: number, scale: number, marks: ViolinMarks): ViolinMark[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const stat: Record<string, number> = { q1: percentileLinear(sorted, 25), median: percentileLinear(sorted, 50), q3: percentileLinear(sorted, 75) };
  return MARK_NAMES[marks].map((name) => {
    const y = stat[name];
    let i = 1;
    while (i < g.x.length - 1 && g.x[i] < y) i++;
    const t = (y - g.x[i - 1]) / (g.x[i] - g.x[i - 1]);
    const d = g.density[i - 1] + Math.min(1, Math.max(0, t)) * (g.density[i] - g.density[i - 1]);
    return { name, y, x: [p, p + sign * d * scale] };
  });
}

export function sideViolinGeometry(
  r: RidgelineWire,
  slots: readonly number[],
  sides: readonly Side[],
  style: SideViolinStyle,
  data?: readonly (readonly number[])[],
  marks: ViolinMarks = "none",
): SideViolinGeometry {
  const scale = SIDE_HALF_WIDTH / r.d_max;
  const m = slots.length ? Math.max(...slots) + 1 : 0;
  const violins = r.groups.map((g, k) => {
    const p = slots[k];
    const sign = sides[k] === "left" ? -1 : 1;
    const line = g.x.map((x, i): Pt => [p + sign * g.density[i] * scale, x]);
    const fill: Pt[] = [[p, line[0][1]], ...line, [p, line[line.length - 1][1]]];
    const color = style === "split" ? (sides[k] === "left" ? 0 : 1) : p;
    const seg = marks !== "none" && data ? { marks: markSegments(g, data[k], p, sign, scale, marks) } : {};
    return { slot: p, side: sides[k], color, fill, line, ...seg };
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
  /** With `direction`: each line's up / down / same and the legend rows. */
  directions?: PairDirection[];
  legend?: { key: PairDirection; label: string }[];
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

export function pairedGeometry(r: PairedSeries, ci: boolean, direction = false): PairedGeometry {
  const values = [...r.before, ...r.after];
  const means = ci ? r.sides.map((s, x) => ({ x, ...s })) : [];
  for (const m of means) values.push(m.lo, m.hi);
  const dirs = r.before.map((u, i): PairDirection => (r.after[i] > u ? "up" : r.after[i] < u ? "down" : "same"));
  const dir = direction
    ? { directions: dirs, legend: DIRECTIONS.map((key, k) => ({ key, label: `${DIRECTION_LABELS[k]} (${dirs.filter((d) => d === key).length})` })) }
    : {};
  return {
    ...dir,
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
  /** Horizontal only: dot k's Y position (the first at the top). */
  positions?: number[];
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

export function lollipopGeometry(r: LollipopSeries, horizontal = false): LollipopGeometry {
  const vals = r.order.map((i) => r.values[i]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = hi > lo ? 0.05 * (hi - lo) : 1;
  if (horizontal) {
    const positions = vals.map((_, k) => vals.length - 1 - k);
    return {
      x_domain: [lo - pad, hi + pad],
      y_domain: [-0.5, vals.length - 0.5],
      positions,
      stems: vals.map((v, k): [Pt, Pt] => [[0, positions[k]], [v, positions[k]]]),
      dots: vals.map((v, k): Pt => [v, positions[k]]),
    };
  }
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
