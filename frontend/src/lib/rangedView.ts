// The analysis view narrowed to a row range, for a tool that reads rows itself
// rather than through the resolver's columns (Tabulate, Pie, Ternary; the same
// order as lib/analysisInputs: the range first, then the exclusion mask and the
// Data Filter). `rowIds` are SOURCE worksheet rows, like the resolver's.
// Pure: no store, no React.

import { sliceDataStruct } from "./datasetsplit";
import { rowRangeRefusal, type RowRange } from "./rowRange";
import { analysisView } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

export interface RangedView {
  data: DataStruct | null;
  /** Source rows behind `data`, ascending; null = every row, in order. */
  rowIds: number[] | null;
  /** Why the range cannot be applied (data is then null: never "every row"). */
  refusal: string | null;
}

export function rangedAnalysisView(dataset: Dataset | null | undefined, range: RowRange | null | undefined): RangedView {
  const view = analysisView(dataset);
  if (!dataset || !range) return { ...view, refusal: null };
  const total = dataset.data.time.length;
  const refusal = rowRangeRefusal(range, total);
  if (refusal || !view.data) return { data: null, rowIds: null, refusal };
  const rows = view.rowIds ?? Array.from({ length: total }, (_value, index) => index);
  const at = rows.flatMap((row, index) => row >= range.from && row <= range.to ? [index] : []);
  return { data: sliceDataStruct(view.data, at), rowIds: at.map((index) => rows[index]!), refusal: null };
}

/** "rows 21-44" when a range narrowed something, else "": a stable text for a
 *  result key, so a result computed under one range is not shown under another. */
export function rowRangeKey(range: RowRange | null | undefined): string {
  return range && range.was === undefined ? `${range.from}-${range.to}` : "";
}
