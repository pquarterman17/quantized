// Cell patches for the dataset-handle cache (./datasetCache). A worksheet edit
// mints a new DataStruct that differs from its parent in a few cells; when the
// server already holds the parent, POST /api/datasets/patch sends those cells
// instead of the whole dataset (1M x 7: 1.53 s JSON.stringify + 156 MB).
//
// The patch list is DIFFED here at send time rather than taken from the edit
// itself: a cell edit also recomputes formula columns (store/useApp.ts's
// `recompute`), which can change other cells and even other rows. A diff is
// the only list that is guaranteed to reproduce the child exactly.
//
// Values go through the same JSON.stringify as a full upload: NaN and +/-Inf
// become null (NaN on the server), -0 becomes 0. So the server's patched copy
// is byte-identical to what a full upload of the child would decode to.

import type { DataStruct } from "../types";

export interface CellPatch {
  row: number;
  /** -1 is the time column. */
  col: number;
  value: number;
}

/** Above this share of the grid's cells, send the whole dataset instead. */
export const MAX_PATCH_FRACTION = 0.05;

/** Same wire content for a small field: identical, or an object/array whose
 *  own entries are identical (or arrays of identical primitives -- labels,
 *  units, level tables rebuilt by a recompute). `undefined` entries are
 *  skipped, as JSON.stringify drops them. */
function sameEntries(a: unknown, b: unknown, depth = 1): boolean {
  if (Object.is(a, b)) return true;
  if (depth < 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameEntries(ra[k], rb[k], depth - 1));
}

/** The cells where `child` differs from `base`, or null when a patch cannot
 *  reproduce a full upload of `child`: any field other than `time`/`values`
 *  changed, the shape changed, or more than MAX_PATCH_FRACTION of the cells
 *  differ. Rows `child` shares with `base` by reference are skipped, so a
 *  single-cell edit costs O(rows), not O(cells). */
export function cellPatches(base: DataStruct, child: DataStruct): CellPatch[] | null {
  const b = base as unknown as Record<string, unknown>;
  const c = child as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(b), ...Object.keys(c)])) {
    if (k !== "time" && k !== "values" && !sameEntries(b[k], c[k])) return null;
  }
  const n = base.time.length;
  if (child.time.length !== n || child.values.length !== base.values.length) return null;
  const width = base.values[0]?.length ?? 0;
  const limit = Math.floor(MAX_PATCH_FRACTION * n * (width + 1));
  const out: CellPatch[] = [];
  for (let r = 0; r < n; r++) {
    if (!Object.is(base.time[r], child.time[r])) {
      if (out.push({ row: r, col: -1, value: child.time[r] }) > limit) return null;
    }
  }
  for (let r = 0; r < base.values.length; r++) {
    const br = base.values[r];
    const cr = child.values[r];
    if (br === cr) continue;
    if (br.length !== cr.length) return null;
    for (let col = 0; col < br.length; col++) {
      if (!Object.is(br[col], cr[col]) && out.push({ row: r, col, value: cr[col] }) > limit) return null;
    }
  }
  return out;
}
