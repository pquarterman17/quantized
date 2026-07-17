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

import { filteredOutRows } from "./datafilter";
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

/** Union a selected-row set into an existing exclusion list ("Exclude
 *  selected" — #50 bulk action), sorted + de-duped. Shared by the legacy
 *  active-dataset selection and the per-worksheet-window one (GUI_INTERACTION
 *  #14) — same math, two callers in store/useApp.ts. */
export function mergeExcluded(current: readonly number[] | undefined, rows: readonly number[]): number[] {
  return [...new Set([...(current ?? []), ...rows])].sort((a, b) => a - b);
}

/** Exclude every row NOT in `rows` ("Keep only selected" — #50 bulk action),
 *  given `n` total rows. Returns undefined (no exclusion) when every row is
 *  kept. */
export function keepOnlyExcluded(rows: readonly number[], n: number): number[] | undefined {
  const keep = new Set(rows);
  const excluded: number[] = [];
  for (let r = 0; r < n; r++) if (!keep.has(r)) excluded.push(r);
  return excluded.length ? excluded : undefined;
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

/** Every row dropped from analysis: manually-excluded (#50) ∪ filter-failed
 *  (#53). The single "what's out" set — the plot masks by it, analysisData
 *  prunes by it, and consumers realign fits by its complement. */
export function droppedRows(ds: Dataset | null | undefined): Set<number> {
  if (!ds) return new Set();
  const excluded = excludedSet(ds);
  const filtered = filteredOutRows(ds.filter, ds.data);
  if (filtered.size === 0) return excluded;
  if (excluded.size === 0) return filtered;
  return new Set([...excluded, ...filtered]);
}

/** Rows dropped by the local filter ONLY (#53) — distinct from manual
 *  exclusion. The Worksheet greys these separately (different tooltip: a
 *  filter-dropped row is still "in" the dataset, just narrowed out by a
 *  predicate the user set and can clear, unlike an exclusion). Sanctioned
 *  wrapper around lib/datafilter.filteredOutRows so callers never need to
 *  import it directly (the architecture guard only allowlists this file). */
export function filteredOutSet(ds: Dataset | null | undefined): Set<number> {
  if (!ds) return new Set();
  return filteredOutRows(ds.filter, ds.data);
}

/** The dataset's analysis view: its DataStruct with both manually-excluded rows
 *  (#50) AND filter-failed rows (#53) pruned. Fit / stat / tabulate consumers
 *  read rows through this so exclusion AND the local filter are honored
 *  everywhere. Returns the SAME data reference when neither is active. */
export function analysisData(ds: Dataset | null | undefined): DataStruct | null {
  if (!ds) return null;
  const drop = droppedRows(ds);
  return drop.size === 0 ? ds.data : pruneExcluded(ds.data, drop);
}

/** Expand a pruned-length array back to full row count: each value at its kept
 *  original-row index, null elsewhere. Realigns a fit computed on the analysis
 *  subset with the full-length plot x (which keeps excluded rows as gaps), so
 *  the overlay stays in register in "grey" mode. */
export function expandToFull(
  pruned: readonly (number | null)[],
  kept: readonly number[],
  n: number,
): (number | null)[] {
  const full: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < kept.length && i < pruned.length; i++) full[kept[i]] = pruned[i];
  return full;
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
