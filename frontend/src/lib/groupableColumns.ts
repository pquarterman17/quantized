// The ONE answer to "which columns can a group / facet / category picker offer?"
//
// A CSV import makes at most ONE text column a categorical channel (the first
// column, when it cannot be the time axis); every other text column stays in
// `metadata.text_columns`, one cell per row. A picker that filters on
// `isCategoricalChannel` alone therefore cannot see the rest, so a plain
// `id,grp,sub,val` file offered nothing to group or facet by (acceptance pass
// 13, B4). Importing every text column as a channel would renumber the channels
// of every file that has one (saved picks, column letters, macros), so the
// pickers read this module instead:
//
//   * `textGroupColumns(d)`  -- the sidecar text columns that can group rows
//     (the rule lives here and nowhere else); the sig-mark pickers
//     (`lib/sigGroupColumns.ts`) key them by their sidecar position.
//   * `withTextGroupChannels(ds)` -- the same dataset with each of those
//     appended as a categorical channel (codes in first-appearance order, like
//     the importer's own encoder). The Statistics stage reads its dataset
//     through this, so its group-by / then-by / facet-by / colour-by pickers see
//     them. Appended AFTER the real channels, so no real channel index moves.

import { isCategoricalChannel } from "./categorical";
import { textColumnEntries } from "./originTextColumnCells";
import type { Dataset, DataStruct } from "./types";

export interface TextGroupColumn {
  /** Position in `textColumnEntries(d)` (the `-2 - k` key convention of `SigMarks`). */
  entry: number;
  label: string;
  cells: readonly unknown[];
}

/** The sidecar text columns that can hold group names: one cell per sheet row, at
 *  least one level, and not already a categorical channel of the same name. */
export function textGroupColumns(d: DataStruct): TextGroupColumn[] {
  const taken = new Set(d.labels.filter((_, i) => isCategoricalChannel(d, i)));
  return textColumnEntries(d).flatMap(([label, cells], entry) => {
    if (cells.length !== d.values.length || taken.has(label)) return [];
    return cells.some((c) => cellText(c) !== "") ? [{ entry, label, cells }] : [];
  });
}

const cellText = (c: unknown): string => {
  const text = c == null ? "" : String(c).trim();
  return text.toLowerCase() === "nan" ? "" : text;
};

const cache = new WeakMap<Dataset, Dataset>();

/** `ds` with every groupable text column appended as a categorical channel. Returns
 *  `ds` itself when there is none, and the same object for the same `ds` (so a
 *  `useMemo` / effect keyed on it does not re-run). A label that is already taken is
 *  skipped rather than duplicated. */
export function withTextGroupChannels(ds: Dataset): Dataset {
  const hit = cache.get(ds);
  if (hit) return hit;
  const d = ds.data;
  const used = new Set(d.labels);
  const extra = textGroupColumns(d).filter((c) => !used.has(c.label));
  if (extra.length === 0) return ds;
  const n = d.labels.length;
  const levels: string[][] = [];
  const codes = extra.map((col) => {
    const seen = new Map<string, number>();
    const out = col.cells.map((raw) => {
      const text = cellText(raw);
      if (text === "") return Number.NaN;
      let code = seen.get(text);
      if (code === undefined) {
        code = seen.size;
        seen.set(text, code);
      }
      return code;
    });
    levels.push([...seen.keys()]);
    return out;
  });
  const cat_levels: Record<number, string[]> = { ...d.cat_levels };
  levels.forEach((l, k) => { cat_levels[n + k] = l; });
  const data: DataStruct = {
    ...d,
    labels: [...d.labels, ...extra.map((c) => c.label)],
    units: [...d.units, ...extra.map(() => "")],
    values: d.values.map((row, i) => [...row, ...codes.map((c) => c[i])]),
    cat_levels,
  };
  const out = { ...ds, data };
  cache.set(ds, out);
  return out;
}
