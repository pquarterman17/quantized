// Sort columns by a label row (Origin's "Sort Columns"): order a worksheet's
// value columns by their Long Name, Units, Comments or a user parameter row.
// Pure: this builds the new order; store/worksheetColumns.ts `reorderColumns`
// applies it as ONE undo step.
//
// Rules, all deliberate:
// - STABLE: columns with equal keys keep their current relative order.
// - A column with a BLANK key goes last in either direction (Origin does the
//   same; "no unit" is not smaller than "A").
// - Text compares naturally and case-insensitively ("T2" before "T10").
// - A parameter whose values are numbers on both sides compares as numbers
//   ("50 K" before "300 K"); otherwise as text.

import { parseParamNumber, userParamRows, userParamValue } from "./userParams";
import type { ColumnProps } from "./columnProps";
import type { DataStruct } from "./types";

export type LabelKey = { kind: "name" | "unit" | "comment" } | { kind: "param"; name: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Column `col`'s text for `key` ("" when it has none). */
export function labelKeyOf(
  data: Pick<DataStruct, "labels" | "units" | "metadata">,
  props: Record<number, ColumnProps> | undefined,
  col: number,
  key: LabelKey,
  rows = key.kind === "param" ? userParamRows(data) : [],
): string {
  switch (key.kind) {
    case "name":
      return (data.labels[col] ?? "").trim();
    case "unit":
      return (data.units[col] ?? "").trim();
    case "comment":
      return (props?.[col]?.comment ?? "").trim();
    case "param":
      return userParamValue(rows, key.name, col);
  }
}

/** `cols` ordered by `key`. `blank` counts the columns with no value. */
export function columnOrderByLabel(
  data: Pick<DataStruct, "labels" | "units" | "metadata">,
  props: Record<number, ColumnProps> | undefined,
  cols: readonly number[],
  key: LabelKey,
  dir: 1 | -1,
): { order: number[]; blank: number } {
  const rows = key.kind === "param" ? userParamRows(data) : [];
  const keyed = cols.map((c, i) => ({ c, i, text: labelKeyOf(data, props, c, key, rows) }));
  const filled = keyed.filter((k) => k.text !== "");
  const blank = keyed.filter((k) => k.text === "");
  const compare = (a: string, b: string): number => {
    if (key.kind === "param") {
      const [x, y] = [parseParamNumber(a), parseParamNumber(b)];
      if (x !== null && y !== null && x !== y) return x - y;
      if (x !== null && y !== null) return 0;
    }
    return collator.compare(a, b);
  };
  filled.sort((a, b) => dir * compare(a.text, b.text) || a.i - b.i);
  return { order: [...filled, ...blank].map((k) => k.c), blank: blank.length };
}

/** The full column permutation (`perm[position] = old column`) that sorts
 *  `targets` among the slots they occupy, leaving every other column where it
 *  is. `targets` empty: every column `0..n-1`. */
export function sortPermutation(
  data: Pick<DataStruct, "labels" | "units" | "metadata">,
  props: Record<number, ColumnProps> | undefined,
  n: number,
  targets: readonly number[],
  key: LabelKey,
  dir: 1 | -1,
): { perm: number[]; blank: number } {
  const slots = (targets.length > 1 ? [...new Set(targets)].filter((c) => c >= 0 && c < n) : Array.from({ length: n }, (_, i) => i)).sort((a, b) => a - b);
  const { order, blank } = columnOrderByLabel(data, props, slots, key, dir);
  const perm = Array.from({ length: n }, (_, i) => i);
  slots.forEach((slot, k) => (perm[slot] = order[k]));
  return { perm, blank };
}
