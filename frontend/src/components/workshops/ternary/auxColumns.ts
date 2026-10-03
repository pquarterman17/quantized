// Column picking shared by the ternary and vector-field workshops: every
// channel plus the X column as index -1 (the useStatsTests convention), read
// straight off a DataStruct — the ANALYSIS view, so excluded and filtered
// rows are already gone by the time a request is built.

import type { DataStruct } from "../../../lib/types";
import { withUnit } from "../../../lib/unitDisplay";

export interface AuxColumn {
  index: number;
  label: string;
}

/** The X column (index -1, named by `x_column_name`) then every channel. */
export function columnOptions(data: DataStruct): AuxColumn[] {
  const xName = String(data.metadata?.["x_column_name"] ?? "x");
  return [{ index: -1, label: xName }, ...data.labels.map((label, index) => ({ index, label }))];
}

export function columnLabel(data: DataStruct, index: number): string {
  if (index < 0) return String(data.metadata?.["x_column_name"] ?? "x");
  return data.labels[index] ?? `col ${index}`;
}

/** `label (unit)` when the channel carries a unit, else the bare label. */
export function columnAxisLabel(data: DataStruct, index: number): string {
  const label = columnLabel(data, index);
  const unit = index >= 0 ? data.units[index] : undefined;
  return withUnit(label, unit);
}

/** The column's value at `row`; NaN when the column is missing. */
export function cellValue(data: DataStruct, index: number, row: number): number {
  const v = index < 0 ? data.time[row] : data.values[row]?.[index];
  return typeof v === "number" ? v : NaN;
}

/** The first `n` distinct channel indices (0..), for a sensible default pick. */
export function defaultPicks(data: DataStruct, n: number): number[] {
  const picks: number[] = [];
  for (let i = 0; i < n; i++) picks.push(i < data.labels.length ? i : -1);
  return picks;
}
