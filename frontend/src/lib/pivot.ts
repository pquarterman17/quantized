// Time-series pivot (plan item 34): reshape LONG data (one row per time x key, with a value) to WIDE
// (one row per time, one column per key) and back. Pure; the commit (a NEW worksheet through the
// shared result contract, so it goes stale when its source changes and one undo removes it) is
// store/pivotRun.ts, the dialog is components/workshops/sheetstructure/PivotDialog.tsx.
//
// The rules, stated once (a test checks them against pandas.pivot / pivot_table / melt through the
// shared fixture tests/fixtures/wire/pivot.json, produced by tests/test_pivot_fixture.py):
// - Wide rows are the DISTINCT times, ascending. Wide columns are the keys in `keyOrder` (numeric keys
//   ascending, a categorical column's level order, a text column's first appearance).
// - A (time, key) cell with no long row is missing (NaN), as pandas fills it.
// - A row whose time is not a finite number, or whose key is missing, cannot be placed and is left out
//   (counted in `skipped`, which the caller reports).
// - DUPLICATES: the same (time, key) twice. The default rule "refuse" refuses, naming the first
//   pair, as pandas.pivot raises. Any other rule aggregates the pair's values and says so: mean, sum,
//   min, max, first, last, count. Aggregates IGNORE missing values (pandas.pivot_table's default);
//   a group with only missing values is missing (count: 0).
// - melt (wide to long) emits one block per column in order, rows in time order inside a block, as
//   pandas.melt does. `skipEmpty` drops the rows whose value is missing (default off, like pandas).

export type PivotRule = "refuse" | "mean" | "sum" | "min" | "max" | "first" | "last" | "count";

export const PIVOT_RULES: readonly { rule: PivotRule; label: string }[] = [
  { rule: "refuse", label: "Refuse (stop and name the pair)" },
  { rule: "mean", label: "Mean" },
  { rule: "sum", label: "Sum" },
  { rule: "min", label: "Minimum" },
  { rule: "max", label: "Maximum" },
  { rule: "first", label: "First" },
  { rule: "last", label: "Last" },
  { rule: "count", label: "Count of values" },
];

export interface LongRows {
  time: readonly number[];
  /** Each row's key label, or null for a missing key. */
  key: readonly (string | null)[];
  value: readonly number[];
}

export interface WideTable {
  time: number[];
  keys: string[];
  /** `values[row][keyIndex]`. */
  values: number[][];
  /** Rows left out because their time or key was missing. */
  skipped: number;
  /** Cells that came from more than one long row (aggregated under a rule other than refuse). */
  merged: number;
}

function aggregate(rule: PivotRule, vs: readonly number[]): number {
  const ok = vs.filter((v) => !Number.isNaN(v));
  if (rule === "count") return ok.length;
  if (ok.length === 0) return Number.NaN;
  switch (rule) {
    case "sum": return ok.reduce((a, b) => a + b, 0);
    case "mean": return ok.reduce((a, b) => a + b, 0) / ok.length;
    case "min": return ok.reduce((a, b) => (b < a ? b : a));
    case "max": return ok.reduce((a, b) => (b > a ? b : a));
    case "first": return ok[0];
    default: return ok[ok.length - 1];
  }
}

/** Long to wide. `keyOrder` lists the key labels in column order; a key not in it is a missing key. */
export function pivotLongToWide(rows: LongRows, keyOrder: readonly string[], rule: PivotRule): WideTable | { error: string } {
  const colOf = new Map(keyOrder.map((k, i) => [k, i]));
  const placeable = (i: number): boolean => Number.isFinite(rows.time[i]) && rows.key[i] !== null && colOf.has(rows.key[i] as string);
  const times = [...new Set(rows.time.filter((_t, i) => placeable(i)))].sort((a, b) => a - b);
  const rowOf = new Map(times.map((t, i) => [t, i]));
  const cells = new Map<number, number[]>(); // rowIndex * width + col -> long values, in row order
  let skipped = 0;
  for (let i = 0; i < rows.time.length; i++) {
    const r = rowOf.get(rows.time[i]);
    const k = rows.key[i];
    const c = k === null ? undefined : colOf.get(k);
    if (!placeable(i) || r === undefined || c === undefined) {
      skipped++;
      continue;
    }
    const at = r * keyOrder.length + c;
    const list = cells.get(at);
    if (!list) cells.set(at, [rows.value[i]]);
    else if (rule === "refuse") return { error: `time ${times[r]} has more than one row for "${keyOrder[c]}": choose a rule (mean, sum, first, ...) to combine them, or fix the data` };
    else list.push(rows.value[i]);
  }
  let merged = 0;
  const values = times.map((_, r) =>
    keyOrder.map((_k, c) => {
      const list = cells.get(r * keyOrder.length + c);
      if (!list) return Number.NaN;
      if (list.length > 1) merged++;
      return rule === "refuse" ? list[0] : aggregate(rule, list);
    }),
  );
  return { time: times, keys: [...keyOrder], values, skipped, merged };
}

export interface LongTable {
  time: number[];
  /** Key codes into `keys`, one per row. */
  key: number[];
  keys: string[];
  value: number[];
}

/** Wide to long (melt). `columns[c]` is column c's label; `values[row][c]`. */
export function meltWideToLong(time: readonly number[], values: readonly (readonly number[])[], columns: readonly { index: number; label: string }[], skipEmpty: boolean): LongTable {
  const out: LongTable = { time: [], key: [], keys: columns.map((c) => c.label), value: [] };
  columns.forEach((c, code) => {
    for (let r = 0; r < time.length; r++) {
      const v = values[r]?.[c.index] ?? Number.NaN;
      if (skipEmpty && Number.isNaN(v)) continue;
      out.time.push(time[r]);
      out.key.push(code);
      out.value.push(v);
    }
  });
  return out;
}
