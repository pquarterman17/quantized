// Append by column NAME (audit P2.5 — "previewed append"). `mergeDatasets`
// (lib/merge.ts) appends by POSITION; matching by name first re-lays every
// input out onto one shared column list, then hands those to the same
// position append, so the row/sidecar/level-table handling is not duplicated.
//
// The shared list is the FIRST input's columns in its own order, then each
// later input's new names in the order first met — so dataset 0's column
// indices never move and its column-indexed metadata stays true. Names match
// trimmed and case-insensitively; a name repeated within one input pairs its
// k-th occurrence with the k-th occurrence elsewhere. A column an input does
// not have is filled with NaN for that input's rows, and `analyzeMerge`
// reports it (never dropped silently).

import { categoricalLevels } from "./categorical";
import type { DataStruct } from "./types";

export type AppendMatch = "position" | "name";

export interface NameAlignment {
  labels: string[];
  units: string[];
  /** `cols[d][c]`: input d's channel for output column c, or -1 (missing). */
  cols: number[][];
}

const norm = (label: string, c: number): string => (label.trim() || `column ${c + 1}`).toLowerCase();

/** The shared column list for `datasets` and where each input's columns go. */
export function alignColumnsByName(datasets: readonly DataStruct[]): NameAlignment {
  const index = new Map<string, number>();
  const labels: string[] = [];
  const units: string[] = [];
  const perInput = datasets.map((d) => {
    const seen = new Map<string, number>();
    return d.labels.map((label, c) => {
      const name = norm(label, c);
      const k = seen.get(name) ?? 0;
      seen.set(name, k + 1);
      const key = `${name}\u0000${k}`;
      let out = index.get(key);
      if (out === undefined) {
        out = labels.length;
        index.set(key, out);
        labels.push(label);
        units.push("");
      }
      // The first input that RECORDS a unit names the column's unit.
      if (!units[out] && (d.units[c] ?? "").trim()) units[out] = d.units[c];
      return out;
    });
  });
  const cols = perInput.map((outs) => {
    const row = labels.map(() => -1);
    outs.forEach((out, c) => { row[out] = c; });
    return row;
  });
  return { labels, units, cols };
}

/** Input `di` laid out on the shared columns: its values moved to their
 *  column, NaN where it has none. A missing column borrows the level table of
 *  the first input that has one (NaN is a blank under any table), so a
 *  categorical column stays categorical through the append. */
function realign(datasets: readonly DataStruct[], a: NameAlignment, di: number): DataStruct {
  const d = datasets[di];
  const map = a.cols[di];
  const cat_levels: Record<number, string[]> = {};
  const level_order: Record<number, number[]> = {};
  map.forEach((src, out) => {
    if (src >= 0) {
      const own = categoricalLevels(d, src);
      if (own) cat_levels[out] = own;
      const order = d.level_order?.[src];
      if (own && Array.isArray(order)) level_order[out] = order;
      return;
    }
    const donor = datasets.findIndex((o, oi) => a.cols[oi][out] >= 0 && categoricalLevels(o, a.cols[oi][out]));
    if (donor >= 0) cat_levels[out] = categoricalLevels(datasets[donor], a.cols[donor][out]) ?? [];
  });
  return {
    time: d.time,
    values: d.values.map((row) => map.map((src) => (src >= 0 ? row?.[src] ?? Number.NaN : Number.NaN))),
    labels: a.labels,
    units: a.units,
    metadata: d.metadata,
    ...(Object.keys(cat_levels).length ? { cat_levels } : {}),
    ...(Object.keys(level_order).length ? { level_order } : {}),
  };
}

/** Every input re-laid onto the shared, name-matched column list. */
export function alignByName(datasets: readonly DataStruct[]): DataStruct[] {
  const a = alignColumnsByName(datasets);
  return datasets.map((_, di) => realign(datasets, a, di));
}
