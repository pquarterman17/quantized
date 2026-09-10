// Small pure helpers over DataStruct/Dataset. Kept out of the store so they can
// be unit-tested without a store instance.

import type { DataStruct } from "./types";

/** Deep-copy a DataStruct so the copy shares no mutable arrays with the source
 *  (duplicating a dataset must not alias the original's columns).
 *
 *  SPREAD-FIRST, DELIBERATELY. This used to be a hand-written allowlist of the
 *  five required fields, which silently dropped EVERY optional one. The
 *  measured harm was `cat_levels`: `duplicateDataset` (store/useApp.ts) and
 *  `freezeCopy` (store/derivedWorksheets.ts) turned a categorical dataset into
 *  a plain numeric one — raw float codes in the worksheet and every plot where
 *  the parent showed level labels — which is doubly odd next to
 *  `duplicateDataset`'s careful copying of `channelTypes`/`channelRoles`/
 *  `errorRoles`, the rest of the per-channel metadata.
 *
 *  The allowlist was the bug, not any one missing line: it fails again the next
 *  time a field is added to `DataStruct`. Spreading first means a new field is
 *  carried by DEFAULT and only has to be named here if it needs its own deep
 *  copy. `books`/`book_source`/`figures`/`origin_fidelity` are the other
 *  optional fields today, and they are NOT a demonstrated loss: `store/
 *  importDatasets.ts` deletes all four before `data` ever becomes a stored
 *  `Dataset.data` (`:166-167`, `:249-250`), so they never reach this function.
 *  The spread carries them if that ever changes; it does not fix a live bug.
 *
 *  The deep copies uphold this function's stated contract — the copy shares no
 *  mutable array with the source — and `cat_levels`' per-channel level arrays
 *  are arrays, so they are copied too. Nothing depends on that yet: today's one
 *  writer, `store/cellEdit.ts`'s `setCategoricalCell` ("+ Add new level"), is
 *  copy-on-write rather than an in-place append. Note the asymmetry with
 *  `lib/datasetsplit.ts`'s `sliceDataStruct`, which ALIASES the level table by
 *  design (a row slice never rewrites it) — both are safe under copy-on-write;
 *  only this one promises non-aliasing. */
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
    // Group O-2: `level_order`'s per-channel arrays need the same treatment for
    // the same measured reason as `cat_levels` above — a shallow spread would
    // leave the copy sharing the ORIGINAL's arrays, so reordering one dataset's
    // levels would silently reorder its duplicate's too.
    ...(d.level_order
      ? {
          level_order: Object.fromEntries(
            Object.entries(d.level_order).map(([ch, codes]) => [ch, [...codes]]),
          ),
        }
      : {}),
  };
}
