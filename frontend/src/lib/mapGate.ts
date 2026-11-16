// Grid-detection engine behind the Map tab gate (UX-D). LAZY: reached only through
// `ensureMapGate` in lib/mapdata.ts (and `repeats` from lib/mapdataFetch.ts), so
// none of it is in the eager bundle. See `canRenderMap` for the rule.

import type { DataStruct } from "./types";

/** True when `col` repeats values the way a gridded axis does: at most half
 *  as many distinct finite values as rows. A swept axis (every value new) or
 *  a continuous measured signal never does. */
export function repeats(col: (number | null | undefined)[]): boolean {
  // levels-allowlist: counts DISTINCT values of a numeric axis to tell a
  // gridded axis from a sweep -- not a column's category levels.
  const seen = new Set<number>();
  const limit = col.length / 2;
  for (const v of col) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    seen.add(v);
    if (seen.size > limit) return false;
  }
  return seen.size >= 2;
}

/** Pair scans / rows examined since load (the gate's perf invariant). */
export const mapGateWork = { pairScans: 0, pairRows: 0 };
const SAMPLE_ROWS = 20_000;
const MAX_CANDIDATES = 8;

interface Axis {
  idx: Int32Array; // level index per sampled row, -1 where not finite
  val: Float64Array; // the sampled values (NaN where not finite)
  levels: number;
}

/** Level-index a column over the sampled rows; null unless it repeats like an
 *  axis (3..m/2 distinct finite values). */
function axisOf(m: number, at: (r: number) => number | null | undefined): Axis | null {
  // levels-allowlist: counts distinct numeric axis values -- not category levels.
  const seen = new Map<number, number>();
  const idx = new Int32Array(m);
  const val = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const v = at(r);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      idx[r] = -1;
      val[r] = NaN;
      continue;
    }
    let k = seen.get(v);
    if (k === undefined) {
      k = seen.size;
      seen.set(v, k);
      if (seen.size > m / 2) return null;
    }
    idx[r] = k;
    val[r] = v;
  }
  return seen.size >= 3 ? { idx, val, levels: seen.size } : null;
}

export function hasGridAxes(data: DataStruct): boolean {
  const n = data.values.length;
  let stride = Math.ceil(n / SAMPLE_ROWS);
  if (stride > 1 && stride % 2 === 0) stride++; // odd: avoid aliasing with even line lengths
  const m = Math.floor((n - 1) / stride) + 1;
  const cand: Axis[] = [];
  const t = axisOf(m, (r) => data.time[r * stride]);
  if (t) cand.push(t);
  for (let c = 0; c < data.labels.length && cand.length < MAX_CANDIDATES; c++) {
    const a = axisOf(m, (r) => data.values[r * stride][c]);
    if (a) cand.push(a);
  }
  for (let a = 0; a < cand.length; a++) {
    for (let b = a + 1; b < cand.length; b++) if (tiles(cand[a], cand[b], m)) return true;
  }
  return false;
}

/** Per slow-axis level: rows in the line, new fast values, and whether the fast
 *  value ever reverses direction along the line (row order). */
class Lines {
  cnt: Int32Array; fresh: Int32Array; bad: Uint8Array;
  private last: Float64Array; private dir: Int8Array;
  constructor(levels: number) {
    this.cnt = new Int32Array(levels); this.fresh = new Int32Array(levels); this.bad = new Uint8Array(levels);
    this.last = new Float64Array(levels).fill(NaN); this.dir = new Int8Array(levels);
  }
  add(slow: number, fast: number, isNew: boolean): void {
    this.cnt[slow]++;
    if (isNew) this.fresh[slow]++;
    const p = this.last[slow];
    const s = Math.sign(fast - p); // NaN on a line's first point: no direction yet
    if (s !== 0 && s === s) {
      if (this.dir[slow] === 0) this.dir[slow] = s;
      else if (this.dir[slow] !== s) this.bad[slow] = 1;
    }
    this.last[slow] = fast;
  }
}

/** Do two candidate axes tile a grid (full, or as uniform monotone scan lines)? */
function tiles(a: Axis, b: Axis, m: number): boolean {
  // Lines need >=3 points on each side, so the thinner axis has <= m/3 levels.
  if (Math.min(a.levels, b.levels) > m / 3) return false;
  mapGateWork.pairScans++;
  mapGateWork.pairRows += m;
  const cells = a.levels * b.levels;
  const bits = cells <= 4_000_000 ? new Uint8Array(cells) : null;
  const set = bits ? null : new Set<number>();
  const byA = new Lines(a.levels), byB = new Lines(b.levels);
  let pairs = 0;
  for (let r = 0; r < m; r++) {
    const ia = a.idx[r], ib = b.idx[r];
    if (ia < 0 || ib < 0) continue;
    const key = ia * b.levels + ib;
    const isNew = !(bits ? bits[key] : set!.has(key));
    if (isNew) {
      if (bits) bits[key] = 1;
      else set!.add(key);
      pairs++;
    }
    byA.add(ia, b.val[r], isNew);
    byB.add(ib, a.val[r], isNew);
  }
  if (pairs >= 0.8 * cells) return true;
  // the fast axis must recur across lines (each level visited by >=3 rows)
  return (b.levels <= m / 3 && uniformLines(byA)) || (a.levels <= m / 3 && uniformLines(byB));
}

/** >=3 slow-axis lines of >=3 points, near-constant (+-20 %) length, whose fast
 *  values are mostly new and run in one direction along each line. */
function uniformLines(l: Lines): boolean {
  const live = Array.from(l.cnt).filter((c) => c > 0).sort((x, y) => x - y);
  const median = live[live.length >> 1];
  if (live.length < 3 || median < 3) return false;
  let ok = 0;
  for (let k = 0; k < l.cnt.length; k++) {
    const c = l.cnt[k];
    if (c >= 0.8 * median && c <= 1.25 * median && l.fresh[k] >= 0.8 * c && !l.bad[k]) ok++;
  }
  return ok >= 0.8 * live.length;
}
