// Local data filter (ORIGIN_GAP #53) — a non-destructive, serializable set of
// per-column predicates that narrows a dataset's ANALYSIS view without mutating
// its rows. It rides the same chokepoint as row exclusion (lib/rowstate
// .analysisData folds filter-failed rows in with manually-excluded ones), so
// every view that reads the analysis view (Tabulate, Distribution, …) honors the
// filter for free. Pure: filter + data in → the set of failing row indices out.

import type { ColumnFilter, DataFilter, DataStruct } from "./types";

/** Is a predicate actually constraining anything? An inactive one passes every
 *  row (so a half-configured card doesn't hide all data). */
export function isActive(f: ColumnFilter): boolean {
  if (f.kind === "range") return Number.isFinite(f.min) || Number.isFinite(f.max);
  return Array.isArray(f.values) && f.values.length > 0;
}

/** Does row value `v` pass a single (assumed-active) predicate? */
function passesOne(f: ColumnFilter, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (f.kind === "range") {
    if (Number.isFinite(f.min) && v < (f.min as number)) return false;
    if (Number.isFinite(f.max) && v > (f.max as number)) return false;
    return true;
  }
  return (f.values ?? []).includes(v);
}

const colValue = (data: DataStruct, col: number, row: number): number =>
  col < 0 ? data.time[row] : data.values[row]?.[col];

/** Does `row` pass ALL active predicates (AND across columns)? */
export function rowPasses(filter: DataFilter | undefined, data: DataStruct, row: number): boolean {
  if (!filter) return true;
  for (const f of filter) {
    if (isActive(f) && !passesOne(f, colValue(data, f.col, row))) return false;
  }
  return true;
}

/** The set of original-row indices that FAIL the filter (to be pruned from the
 *  analysis view). Empty when the filter is absent or fully inactive — callers
 *  can then skip pruning entirely (identity fast-path in rowstate). */
export function filteredOutRows(filter: DataFilter | undefined, data: DataStruct): Set<number> {
  const out = new Set<number>();
  if (!filter || !filter.some(isActive)) return out;
  const n = data.time.length;
  for (let r = 0; r < n; r++) {
    if (!rowPasses(filter, data, r)) out.add(r);
  }
  return out;
}

/** Validate a candidate filter (from a .dwk) into well-formed predicates for a
 *  dataset with `nChannels` channels. Drops entries with an out-of-range column,
 *  a bad kind, or no usable bound/values. */
export function sanitizeFilter(candidate: unknown, nChannels: number): DataFilter {
  if (!Array.isArray(candidate)) return [];
  const out: DataFilter = [];
  for (const c of candidate) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const col = o.col;
    if (typeof col !== "number" || !Number.isInteger(col) || col < -1 || col >= nChannels) continue;
    if (o.kind === "range") {
      const f: ColumnFilter = { col, kind: "range" };
      if (typeof o.min === "number" && Number.isFinite(o.min)) f.min = o.min;
      if (typeof o.max === "number" && Number.isFinite(o.max)) f.max = o.max;
      if (isActive(f)) out.push(f);
    } else if (o.kind === "set") {
      const values = Array.isArray(o.values)
        ? o.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        : [];
      if (values.length) out.push({ col, kind: "set", values });
    }
  }
  return out;
}
