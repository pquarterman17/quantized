// Split by column value — the ONE compute (audit P2.5, "previewed ... split").
// The Split dialog's live preview (components/overlays/SplitDatasetDialog)
// and the store's commit (`store/split.ts` `splitDatasetByColumn`, which the
// pipeline replay also runs) both call these, so a previewed child is built
// exactly as the created one: grouped by `splitColumn`, sliced by
// `sliceDataStruct`, warnings stamped, group named in `split_group`.
//
// Lazy: loaded by the (lazy) dialog and by the store action's dynamic import.

import { sliceDataStruct, splitColumn, type SplitGroup } from "./datasetsplit";
import { analyzeSplit, columnName, stampWarnings, type TransformWarning } from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";

export interface SplitComputed {
  groups: SplitGroup[];
  warnings: TransformWarning[];
}

/** Group `ds` by column `col` (-1 = x) and say what the split will warn. */
export function computeSplit(ds: Dataset, col: number, tolerance?: number): SplitComputed {
  const { groups } = splitColumn(ds, col, tolerance);
  return { groups, warnings: analyzeSplit(groups, columnName(ds.data, col)) };
}

/** One group's child data, exactly as the split creates it. */
export function splitChildData(data: DataStruct, group: SplitGroup, warnings: readonly TransformWarning[]): DataStruct {
  const stamped = stampWarnings(sliceDataStruct(data, group.rowIndexes), "split", warnings);
  return { ...stamped, metadata: { ...stamped.metadata, split_group: group.label } };
}
