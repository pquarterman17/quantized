// Small pure helpers over DataStruct/Dataset. Kept out of the store so they can
// be unit-tested without a store instance.

import type { DataStruct } from "./types";

/** Deep-copy a DataStruct so the copy shares no mutable arrays with the source
 *  (duplicating a dataset must not alias the original's columns).
 *
 *  SPREAD-FIRST, DELIBERATELY. This used to be a hand-written allowlist of the
 *  five required fields, which silently dropped EVERY optional one — so
 *  `duplicateDataset` (store/useApp.ts) and `freezeCopy`
 *  (store/derivedWorksheets.ts) turned a categorical dataset into a plain
 *  numeric one (`cat_levels` gone → the worksheet and every plot show raw
 *  float codes instead of level labels) and stripped an Origin import's
 *  `books`/`book_source`/`figures`/`origin_fidelity` as well. The allowlist was
 *  the bug, not any one missing line: it fails again the next time a field is
 *  added to `DataStruct`. Spreading first means a new field is carried by
 *  DEFAULT and only has to be named here if it needs its own deep copy.
 *
 *  What still gets an explicit deep copy is exactly what callers MUTATE
 *  through the worksheet/cell-edit path: the four column arrays, `metadata`,
 *  and `cat_levels`'s per-channel level arrays (`store/cellEdit.ts`'s
 *  "+ Add new level" appends to one). The remaining carried-forward fields
 *  (`books`, `book_source`, `figures`, `origin_fidelity`) are shared by
 *  reference on purpose — they are read-only decode products, and nothing in
 *  the app mutates them in place (verified by grep: no `.books.push`,
 *  `.figures.push`, index assignment or in-place sort anywhere outside tests). */
export function cloneDataStruct(d: DataStruct): DataStruct {
  return {
    ...d,
    time: [...d.time],
    values: d.values.map((row) => [...row]),
    labels: [...d.labels],
    units: [...d.units],
    metadata: { ...d.metadata },
    ...(d.cat_levels
      ? {
          // Keys stay as `Object.entries` gives them: `fromEntries` stringifies
          // any key anyway, so a `Number(ch)` round trip would be dead code.
          cat_levels: Object.fromEntries(
            Object.entries(d.cat_levels).map(([ch, levels]) => [ch, [...levels]]),
          ),
        }
      : {}),
  };
}
