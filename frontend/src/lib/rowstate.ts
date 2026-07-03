// Persistent per-row exclusion — the shared "row state" contract (ORIGIN_GAP
// #50). Excluded rows stay VISIBLE in the worksheet (greyed) but drop from every
// analysis (descriptive stats, extract, and — via pruneExcluded — anything that
// consumes the dataset's analysis view). Stored on the Dataset as a sorted,
// de-duplicated number[] so it round-trips .dwk; helpers convert to/from a Set
// for O(1) membership.
//
// Architecture rule (#50): no view may derive row selection/exclusion outside
// this model. Read exclusion via excludedSet()/pruneExcluded(), never a local
// component mask.

import type { DataStruct, Dataset } from "./types";

type HasExcluded = Pick<Dataset, "excludedRows"> | null | undefined;

/** Excluded original-row indices as an O(1)-membership Set. */
export function excludedSet(ds: HasExcluded): Set<number> {
  return new Set(ds?.excludedRows ?? []);
}

/** Is original row `row` excluded on `ds`? */
export function isRowExcluded(ds: HasExcluded, row: number): boolean {
  return (ds?.excludedRows ?? []).includes(row);
}

/** Toggle `row` in an exclusion list, returning a new sorted, de-duped array. */
export function toggleExcluded(current: readonly number[] | undefined, row: number): number[] {
  const set = new Set(current ?? []);
  if (set.has(row)) set.delete(row);
  else set.add(row);
  return [...set].sort((a, b) => a - b);
}

/** Original-row indices that are NOT excluded, in order (the analysis subset). */
export function activeRowIndices(n: number, excluded: Iterable<number>): number[] {
  const ex = excluded instanceof Set ? excluded : new Set(excluded);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (!ex.has(i)) out.push(i);
  return out;
}

/** A DataStruct with excluded rows removed — the analysis view consumers use.
 *  Returns the input unchanged when nothing is excluded (identity fast-path). */
export function pruneExcluded(data: DataStruct, excluded: Iterable<number>): DataStruct {
  const ex = excluded instanceof Set ? excluded : new Set(excluded);
  if (ex.size === 0) return data;
  const keep = activeRowIndices(data.time.length, ex);
  return {
    ...data,
    time: keep.map((r) => data.time[r]),
    values: keep.map((r) => data.values[r]),
  };
}

/** The dataset's analysis view: its DataStruct with excluded rows pruned. Fit /
 *  stat / tabulate consumers read rows through this so exclusion is honored
 *  everywhere. Returns the SAME data reference when nothing is excluded. */
export function analysisData(ds: Dataset | null | undefined): DataStruct | null {
  if (!ds) return null;
  return pruneExcluded(ds.data, excludedSet(ds));
}

/** Normalize a candidate exclusion list to valid, in-range, sorted, unique
 *  integer indices for a dataset of `n` rows. Used on load (.dwk) and after a
 *  row-count change (cell edits never resize, but a re-import / extract can). */
export function sanitizeExcluded(candidate: unknown, n: number): number[] {
  if (!Array.isArray(candidate)) return [];
  const set = new Set<number>();
  for (const v of candidate) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n) set.add(v);
  }
  return [...set].sort((a, b) => a - b);
}
