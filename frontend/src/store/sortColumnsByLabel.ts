// Sort Columns by a label row, applied: reads the worksheet as it is NOW (a
// dialog may have been open a while), builds the permutation
// (lib/sortColumnsByLabel.ts) and applies it as one undo step
// (store/worksheetColumns.ts `reorderColumns`).

import { sortPermutation, type LabelKey } from "../lib/sortColumnsByLabel";
import { useApp } from "./useApp";
import { reorderColumns } from "./worksheetColumns";

/** `targets`: with two or more, only those columns are sorted, among the places
 *  they hold; otherwise every value column. Returns whether anything moved. */
export function sortColumnsByLabel(id: string, targets: readonly number[], key: LabelKey, dir: 1 | -1, what = "label"): boolean {
  const ds = useApp.getState().datasets.find((d) => d.id === id);
  if (!ds) return false;
  const n = ds.data.labels.length - (ds.formulas?.length ?? 0);
  const { perm, blank } = sortPermutation(ds.data, ds.columnProps, n, targets, key, dir);
  if (!reorderColumns(id, perm, "sort columns by label")) return false;
  if (blank) useApp.getState().setStatus(`sorted columns by ${what} — ${blank} column${blank === 1 ? "" : "s"} with no value placed last`);
  return true;
}
