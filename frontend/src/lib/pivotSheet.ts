// The worksheet half of the time-series pivot (lib/pivot.ts is the reshape itself): which columns
// are the time, the key and the value, the key labels, and the DataStruct of the new worksheet. Pure.

import { categoricalLevels } from "./categorical";
import { originTextColumns } from "./originTextColumns";
import { meltWideToLong, pivotLongToWide, type PivotRule } from "./pivot";
import type { DataStruct } from "./types";

/** A key column: a data channel (index) or an Origin text column (its short name). */
export type PivotKey = { channel: number } | { text: string };

export interface PivotSpec {
  /** The time column: a channel index, or -1 for the worksheet's X column. */
  time: number;
  key: PivotKey;
  value: number;
  rule: PivotRule;
}

const xNameOf = (d: DataStruct): string => String(d.metadata?.["x_column_long"] || d.metadata?.["x_column_name"] || "x");
export const columnNameOf = (d: DataStruct, col: number): string => (col < 0 ? xNameOf(d) : (d.labels[col] ?? `column ${col + 1}`));
const columnUnitOf = (d: DataStruct, col: number): string => (col < 0 ? String(d.metadata?.["x_column_unit"] ?? "") : (d.units[col] ?? ""));
const columnOf = (d: DataStruct, col: number): number[] => (col < 0 ? d.time : d.values.map((r) => r[col] ?? Number.NaN));

/** Each row's key label and the label order: numbers ascending, a categorical column's levels in
 *  level order (those present), a text column in order of first appearance. */
export function keyLabels(d: DataStruct, key: PivotKey): { labels: (string | null)[]; order: string[] } {
  if ("text" in key) {
    const col = originTextColumns(d).find((t) => t.shortName === key.text);
    const labels = d.time.map((_, r) => (col?.rows[r] ?? "").trim() || null);
    return { labels, order: [...new Set(labels.filter((l): l is string => l !== null))] };
  }
  const raw = columnOf(d, key.channel);
  const levels = categoricalLevels(d, key.channel);
  if (levels) {
    const labels = raw.map((v) => (Number.isInteger(v) && v >= 0 && v < levels.length ? levels[v] : null));
    const present = new Set(labels);
    return { labels, order: levels.filter((l) => present.has(l)) };
  }
  const labels = raw.map((v) => (Number.isFinite(v) ? String(v) : null));
  // levels-allowlist: numeric pivot keys become columns in ascending order (pandas.pivot), not category levels.
  const order = [...new Set(raw.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b).map(String);
  return { labels, order };
}

export interface PivotBuilt {
  data: DataStruct;
  skipped: number;
  merged: number;
}

/** Long to wide: one row per distinct time, one column per key. */
export function buildWide(d: DataStruct, spec: PivotSpec): PivotBuilt | { error: string } {
  if (d.time.length === 0) return { error: "the worksheet has no rows" };
  const { labels, order } = keyLabels(d, spec.key);
  if (order.length === 0) return { error: "the key column has no values to make columns from" };
  const wide = pivotLongToWide({ time: columnOf(d, spec.time), key: labels, value: columnOf(d, spec.value) }, order, spec.rule);
  if ("error" in wide) return wide;
  if (wide.time.length === 0) return { error: "no row has both a time and a key" };
  const unit = columnUnitOf(d, spec.value);
  return {
    data: {
      time: wide.time,
      values: wide.values,
      labels: wide.keys,
      units: wide.keys.map(() => unit),
      metadata: {
        x_column_name: columnNameOf(d, spec.time),
        x_column_unit: columnUnitOf(d, spec.time),
        worksheet_transform: "time-series-pivot",
      },
    },
    skipped: wide.skipped,
    merged: wide.merged,
  };
}

/** Wide to long: `columns` become the key column (categorical), the value column follows. */
export function buildLong(d: DataStruct, columns: readonly number[], skipEmpty: boolean, valueName: string): { data: DataStruct } | { error: string } {
  if (columns.length === 0) return { error: "pick at least one column to stack" };
  const long = meltWideToLong(d.time, d.values, columns.map((index) => ({ index, label: d.labels[index] ?? `column ${index + 1}` })), skipEmpty);
  if (long.time.length === 0) return { error: "nothing to stack: every cell of the chosen columns is empty" };
  const units = new Set(columns.map((c) => d.units[c] ?? ""));
  return {
    data: {
      time: long.time,
      values: long.time.map((_, i) => [long.key[i], long.value[i]]),
      labels: ["key", valueName],
      units: ["", units.size === 1 ? [...units][0] : ""],
      metadata: {
        x_column_name: xNameOf(d),
        x_column_unit: String(d.metadata?.["x_column_unit"] ?? ""),
        worksheet_transform: "time-series-unpivot",
      },
      cat_levels: { 0: long.keys },
    },
  };
}
