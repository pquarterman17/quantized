// Map/RSM capability checks — the two predicates needed EAGERLY at import
// time to route/gate the Map tab (lib/quickPlot.ts, lib/plotSelectedTogether.ts,
// lib/stagetab.ts, components/Stage/Stage.tsx).
//
// SCOPE (narrowed 2026-08-23, C2 bundle pass): the actual heatmap-grid
// fetch/regrid + RSM axis-key helpers (`fetchMap`/`buildMapColumns`/
// `regridNearest`/`hasQSpace`/`rsmAxisKeys`/`MapPayload`) now live in
// `lib/mapdataFetch.ts`, reached only from `MapStage` and its ROI/sector-wedge
// helpers — all already behind `MapStage`'s own `lazy()` boundary, never the
// eager tab-routing path. See that file's own header for the
// verified-no-eager-consumer rationale.

import type { DataStruct } from "./types";

/** True when a dataset is a 2-D map (e.g. an XRDML reciprocal-space map): the
 *  parser flagged `metadata.is2D` and it carries the ≥3 channels the map needs
 *  (two axes + intensity). Drives import-time stage routing to the Map tab. */
export function is2DMap(ds: DataStruct): boolean {
  return ds.metadata["is2D"] === true && ds.labels.length >= 3;
}

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

const mappableCache = new WeakMap<DataStruct, boolean>();

/** Can this dataset produce a 2-D map at all? (owner request 2026-07-25)
 *
 *  Defined ONCE here because two consumers ask: `MapStage` (canvas vs. its
 *  "needs 3 channels" notice) and `Stage` (whether the Map TAB exists).
 *
 *  Since figures-audit #13: a parser-flagged 2-D map always qualifies; any
 *  other dataset needs three columns -- the file's first (axis) column
 *  counts, see `mapdataFetch.mapColumns` -- of which at least TWO repeat like gridded
 *  axes (`repeats`). That admits long-form XYZ (`X,Y,Z`, or `i,X,Y,Z`) and
 *  stops offering a Map tab for a 1-D sweep (`Energy,S0..S7`: a swept
 *  axis plus continuous signals), which could only ever draw nonsense.
 *
 *  Deliberately capability, not history: "has a map been drawn" would be
 *  circular -- you could never reach the tab to draw the first one. */
export function canRenderMap(data: DataStruct | null | undefined): boolean {
  if (!data) return false;
  if (data.metadata["is2D"] === true) return data.labels.length >= 3;
  if (data.labels.length + 1 < 3 || data.values.length < 4) return false;
  const cached = mappableCache.get(data);
  if (cached !== undefined) return cached;
  // Repeating columns are only CANDIDATE axes: an instrument file is full of
  // step-valued status/range/setpoint columns that repeat without being a
  // grid (a 38-column MPMS M(T) sweep qualified on that alone). Two candidates
  // form a grid only when their value pairs cover most of the cross product.
  const cand: (number | null | undefined)[][] = [];
  if (repeats(data.time)) cand.push(data.time);
  for (let c = 0; c < data.labels.length && cand.length < 8; c++) {
    const col = data.values.map((row) => row[c]);
    if (repeats(col)) cand.push(col);
  }
  let grid = false;
  for (let a = 0; a < cand.length && !grid; a++) {
    for (let b = a + 1; b < cand.length && !grid; b++) grid = formsGrid(cand[a], cand[b]);
  }
  // Scattered XYZ is opt-in (Plot > Contour from scattered XYZ), never guessed.
  const ok = grid || data.metadata["scatteredXYZ"] === true;
  mappableCache.set(data, ok);
  return ok;
}

/** Do two repeating columns tile a grid? Each needs >=3 levels and the distinct
 *  (a, b) pairs must fill >=80 % of levels(a) x levels(b). */
function formsGrid(a: (number | null | undefined)[], b: (number | null | undefined)[]): boolean {
  // levels-allowlist: counts distinct numeric axis values to test grid
  // coverage -- not a column's category levels (same as `repeats`).
  const la = new Set<number>();
  const lb = new Set<number>();
  const pairs = new Set<string>();
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    la.add(x);
    lb.add(y);
    pairs.add(`${x}|${y}`);
  }
  return la.size >= 3 && lb.size >= 3 && pairs.size >= 0.8 * la.size * lb.size;
}
