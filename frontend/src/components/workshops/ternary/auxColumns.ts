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

/** True when X is only a row counter (the synthetic "Sample Index" of a sheet whose
 *  first column was text, or a 0..N-1 / 1..N run of integers): it labels rows, it is
 *  not a composition, so the defaults pass it over. */
function xIsRowCounter(data: DataStruct): boolean {
  if (data.metadata?.["x_column_name"] === "Sample Index") return true;
  const first = data.time[0];
  return data.time.length > 2 && (first === 0 || first === 1) && data.time.every((t, r) => t === first + r);
}

/** Default composition picks: the first `n` NUMERIC columns in sheet order. The X
 *  column leads (index -1, the sheet's FIRST column on import) when it is a real
 *  numeric column, then the channels in order, so an A,B,C,... sheet reads A, B, C
 *  whether A landed in X or in a channel. Text (categorical) channels and a row-counter
 *  X are skipped. Short of `n` numeric columns, the rest are the remaining channels.
 *  Existing saved figures keep their own picks; this only seeds a new one. */
export function compositionPicks(data: DataStruct, n: number): number[] {
  const channels = data.labels.map((_, i) => i);
  const numeric = channels.filter((i) => !data.cat_levels?.[i]);
  const order = [...(xIsRowCounter(data) ? [] : [-1]), ...numeric, ...channels.filter((i) => !numeric.includes(i))];
  return Array.from({ length: n }, (_, k) => order[k] ?? -1);
}
