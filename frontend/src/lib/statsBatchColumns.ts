// What a statistics tool's column pick means in ANOTHER worksheet (lane BY).
//
// The statistics tools (Distribution, Fit Y by X, Outlier screening, ...) pick
// their columns by index on the active worksheet, not by plot role. A batch
// over selected worksheets therefore reads, in each worksheet, the column with
// the SAME NAME. Fail closed: a worksheet with no such column, or with two
// columns of that name, is an error row for that worksheet, never a guess by
// position. Index -1 is the worksheet's X / time axis (its `x_column_name`).

import { analysisData } from "./rowstate";
import type { Dataset, DataStruct } from "./types";

/** The axis name a worksheet shows for index -1 (the tools' own convention). */
export function xAxisName(data: DataStruct): string {
  return String(data.metadata?.["x_column_name"] ?? "x");
}

/** The name of a pick on `data` (index -1 = the X axis); null when out of range. */
export function columnName(data: DataStruct, index: number): string | null {
  if (index === -1) return xAxisName(data);
  return Number.isInteger(index) && index >= 0 && index < data.labels.length ? data.labels[index]! : null;
}

/** The index of the column named `name` in `data` (-1 = the X axis). Throws a
 *  message that says why when the name is missing or ambiguous. */
export function columnByName(data: DataStruct, name: string): number {
  const matches: number[] = [];
  if (xAxisName(data) === name) matches.push(-1);
  data.labels.forEach((label, index) => { if (label === name) matches.push(index); });
  if (matches.length === 0) throw new Error(`No column named "${name}" in this worksheet.`);
  if (matches.length > 1) {
    throw new Error(`${matches.length} columns are named "${name}" in this worksheet; rename one so the batch knows which to read.`);
  }
  return matches[0]!;
}

/** Column values as numbers; index -1 reads the X axis. */
export function columnValues(data: DataStruct, index: number): number[] {
  return index < 0 ? data.time : data.values.map((row) => row[index]!);
}

/** A worksheet's analysis view (excluded and filtered-out rows dropped), the
 *  statistics tools' single-run row policy. Throws when nothing is left. */
export function statsBatchData(dataset: Dataset): DataStruct {
  const data = analysisData(dataset);
  if (!data || data.time.length === 0) throw new Error("No rows remain in this worksheet's analysis view.");
  return data;
}
