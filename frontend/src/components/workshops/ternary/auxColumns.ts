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

/** True when every complete row of `cols` sums to one constant (within 2%): a
 *  composition, as fractions or percent. Needs at least two complete rows. */
function sumsConstant(data: DataStruct, cols: number[]): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  let rows = 0;
  for (let r = 0; r < data.time.length; r++) {
    let s = 0;
    for (const c of cols) s += cellValue(data, c, r);
    if (!Number.isFinite(s)) continue;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
    rows++;
  }
  return rows >= 2 && hi > 0 && hi - lo <= 0.02 * hi;
}

/** Does the X column lead the composition picks? Only on evidence: the channels
 *  alone cannot fill a triangle, or X with the first two channels sums to a constant
 *  on every row while the first three channels do not. A time, temperature or
 *  row-counter X is the common case and never leads otherwise. */
function xLeads(data: DataStruct, numeric: number[]): boolean {
  if (numeric.length < 3) return true;
  if (xIsRowCounter(data)) return false;
  return sumsConstant(data, [-1, numeric[0], numeric[1]]) && !sumsConstant(data, numeric.slice(0, 3));
}

/** Default composition picks: the first `n` NUMERIC columns in sheet order, with the
 *  X column (index -1, the sheet's FIRST column on import) in front only when
 *  `xLeads` finds it is a composition column, so an A,B,C sheet reads A, B, C whether
 *  A landed in X or in a channel, and a t, A, B, C sheet still reads A, B, C. Text
 *  (categorical) channels are skipped. Short of `n` numeric columns, the rest are the
 *  remaining channels. Existing saved figures keep their own picks; this only seeds a
 *  new one. */
export function compositionPicks(data: DataStruct, n: number): number[] {
  const channels = data.labels.map((_, i) => i);
  const numeric = channels.filter((i) => !data.cat_levels?.[i]);
  const order = [...(xLeads(data, numeric) ? [-1] : []), ...numeric, ...channels.filter((i) => !numeric.includes(i))];
  return Array.from({ length: n }, (_, k) => order[k] ?? -1);
}
