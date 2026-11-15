// Set Column Values (gap audit 4, G3) — the pure half of the dialog
// (components/Stage/worksheet/SetColumnValuesDialog.tsx) and its apply (store/setColumnValuesRun.ts):
// what a target column is, the row range, the live preview, and the
// function / column / operator browsers' entries. Lazy, with the dialog.
//
// Where the result goes, and whether the formula is KEPT:
//   - a new column, or an existing computed (ƒx) column: the formula is the
//     column. It is stored on it, recalculated whenever its inputs change, and
//     reopening this dialog on the column edits it. A row range is part of
//     that stored formula, spelled out where the user can read it:
//     `if(row() >= 3 and row() <= 9, <formula>, nan)` — reopening the dialog
//     reads the range back out of it.
//   - an existing data column (or X): the worksheet model keeps formulas only
//     on computed columns, which always sit after the data columns, so a data
//     column can hold VALUES, not a formula. The formula is evaluated once and
//     its values written into the rows of the range — one undo step — and the
//     dialog says so rather than pretending the formula stays attached.
//
// The preview and the apply run the SAME evaluation (`evaluateFormula`), so a
// value the preview shows is the value that gets written.

import { isCategoricalChannel } from "./categorical";
import { applyFormulasWithErrors, channelLetter } from "./formula";
import { resolveColumnNames } from "./formulaRefs";
import { linkSheets } from "./sheetRefs";
import type { Dataset } from "./types";

export type ScvTarget = { kind: "new" } | { kind: "column"; col: number };

export type TargetKind = "new" | "computed" | "data" | "x" | "categorical";

/** Value columns before the computed ones. */
export const baseCountOf = (ds: Dataset): number => ds.data.labels.length - (ds.formulas?.length ?? 0);

export function targetKind(ds: Dataset, target: ScvTarget): TargetKind {
  if (target.kind === "new") return "new";
  if (target.col < 0) return "x";
  if (target.col >= baseCountOf(ds)) return "computed";
  return isCategoricalChannel(ds.data, target.col) ? "categorical" : "data";
}

/** What applying does to this target, in words the dialog shows. */
export function targetNote(kind: TargetKind): string {
  switch (kind) {
    case "new":
      return "Adds a computed column. The formula stays on it and recalculates when its inputs change.";
    case "computed":
      return "Replaces this column's formula. It stays on the column and recalculates when its inputs change.";
    case "categorical":
      return "This is a categorical column; its cells are level codes. Write the formula to a new column instead.";
    default:
      return "Writes values once, into the rows of the range (one undo step). A data column keeps values, not formulas: to keep the formula and recalculate it later, write to a new column.";
  }
}

export interface RowRange {
  /** 1-based, inclusive — the grid's row numbers. */
  from: number;
  to: number;
}

/** The range typed as From / To (blank = the first / last row), or why not. */
export function parseRange(fromText: string, toText: string, rows: number): RowRange | { error: string } {
  if (rows === 0) return { error: "the worksheet has no rows — Set row count first" };
  const read = (text: string, blank: number, what: string): number | string => {
    const t = text.trim();
    if (t === "") return blank;
    const v = Number(t);
    if (!Number.isInteger(v)) return `${what} row must be a whole number`;
    if (v < 1 || v > rows) return `${what} row must be between 1 and ${rows}`;
    return v;
  };
  const from = read(fromText, 1, "From");
  const to = read(toText, rows, "To");
  if (typeof from === "string") return { error: from };
  if (typeof to === "string") return { error: to };
  if (to < from) return { error: "To must not be before From" };
  return { from, to };
}

const isFull = (r: RowRange, rows: number): boolean => r.from <= 1 && r.to >= rows;

const RANGE_RE = /^if\(row\(\) >= (\d+) and row\(\) <= (\d+), ([\s\S]*), nan\)$/;

/** The formula a computed column stores for `expr` over `range`. */
export function wrapRange(expr: string, range: RowRange, rows: number): string {
  return isFull(range, rows) ? expr : `if(row() >= ${range.from} and row() <= ${range.to}, ${expr}, nan)`;
}

/** A stored formula read back into the formula and range the dialog shows. */
export function unwrapRange(stored: string): { expr: string; from: string; to: string } {
  const m = RANGE_RE.exec(stored.trim());
  return m ? { expr: m[3], from: m[1], to: m[2] } : { expr: stored, from: "", to: "" };
}

export type Evaluation = { values: number[]; error?: undefined } | { values?: undefined; error: string };

/** `expr` evaluated over every row of `ds`, as a column appended after all of
 *  its columns — exactly what the apply writes. Fail closed: an unknown or
 *  ambiguous column, a broken sheet() link, or any row that fails to evaluate
 *  is an error, never a partial column. */
export function evaluateFormula(ds: Dataset, datasets: readonly Dataset[], expr: string): Evaluation {
  const text = expr.trim();
  if (!text) return { error: "type a formula" };
  let resolved: string;
  try {
    resolved = resolveColumnNames(text, ds.data.labels);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const linked = linkSheets(resolved, datasets, ds.id);
  if ("error" in linked) return { error: linked.error };
  const { data, errors } = applyFormulasWithErrors(ds.data, [{ name: "(preview)", expr: resolved, sheets: linked.sheets }]);
  const error = errors["(preview)"];
  if (error) return { error };
  return { values: data.values.map((row) => row[row.length - 1]) };
}

export interface PreviewRow {
  row: number; // 1-based
  before: number | null; // null: a new column has no current value
  after: number;
}

/** The first `limit` rows of the range: current value and new value. */
export function previewRows(ds: Dataset, target: ScvTarget, values: readonly number[], range: RowRange, limit = 8): PreviewRow[] {
  const out: PreviewRow[] = [];
  for (let r = range.from; r <= range.to && out.length < limit; r++) {
    const i = r - 1;
    const before = target.kind === "new" ? null : target.col < 0 ? ds.data.time[i] : (ds.data.values[i]?.[target.col] ?? NaN);
    out.push({ row: r, before, after: values[i] });
  }
  return out;
}

/** The dialog's "Into" choices: X, every column, then a new column. */
export function targetOptions(ds: Dataset, xName: string): { value: string; label: string }[] {
  const base = baseCountOf(ds);
  return [
    { value: "-1", label: `X — ${xName || "X"} (values)` },
    ...ds.data.labels.map((l, c) => ({ value: String(c), label: `${channelLetter(c)} — ${l}${c >= base ? " (ƒx formula)" : isCategoricalChannel(ds.data, c) ? " (categorical)" : " (values)"}` })),
    { value: "new", label: "New column (keeps the formula)" },
  ];
}

export interface InsertEntry {
  label: string;
  /** Inserted at the cursor; `|` marks where the cursor goes after (else the end). */
  text: string;
}

export const FUNCTION_ENTRIES: InsertEntry[] = [
  ...["sin", "cos", "tan", "exp", "ln", "log10", "sqrt", "abs"].map((f) => ({ label: `${f}(v)`, text: `${f}(|)` })),
  { label: "round(v, digits) — numpy: halves to even", text: "round(|, 2)" },
  { label: "floor(v, digits)", text: "floor(|, 2)" },
  { label: "ceil(v, digits)", text: "ceil(|, 2)" },
  { label: "erf(v)", text: "erf(|)" },
  { label: "erfc(v)", text: "erfc(|)" },
  { label: "gamma(v)", text: "gamma(|)" },
  { label: "lgamma(v) — log|Γ(v)|", text: "lgamma(|)" },
  { label: "rnd(seed) — uniform in [0, 1)", text: "rnd(1)|" },
  { label: "normal(seed) — standard normal", text: "normal(1)|" },
  { label: "interp(v, X, Y) — look Y up along X", text: "interp(|, A, B)" },
  { label: "if(condition, a, b)", text: "if(|, , )" },
  { label: "row() — the row number", text: "row()|" },
  { label: "lag(A, k) — k rows back", text: "lag(|, 1)" },
  { label: "diff(A)", text: "diff(|)" },
  { label: "cumsum(A)", text: "cumsum(|)" },
  ...["mean", "sd", "median", "min", "max", "sum", "count"].map((f) => ({ label: `${f}(A) — whole column`, text: `${f}(|)` })),
  ...["rowmean", "rowsd", "rowsum"].map((f) => ({ label: `${f}(A, B, …) — across columns`, text: `${f}(|)` })),
];

export const OPERATOR_ENTRIES: InsertEntry[] = [
  ["+", " + "],
  ["−", " - "],
  ["×", " * "],
  ["÷", " / "],
  ["power ^", "^"],
  ["floor division //", " // "],
  ["remainder %", " % "],
  ["( )", "(|)"],
  ["==", " == "],
  ["!=", " != "],
  ["<", " < "],
  ["<=", " <= "],
  [">", " > "],
  [">=", " >= "],
  ["and", " and "],
  ["or", " or "],
  ["not", "not "],
  ["c ? a : b", " ? | : "],
  ["pi", "pi"],
  ["nan (blank)", "nan"],
].map(([label, text]) => ({ label, text }));

/** The column browser: x and every column letter, named. */
export function columnEntries(ds: Dataset, xName: string): InsertEntry[] {
  return [{ label: `x — ${xName || "X"}`, text: "x" }, ...ds.data.labels.map((l, c) => ({ label: `${channelLetter(c)} — ${l}`, text: channelLetter(c) }))];
}

/** `entry` inserted into `text` over the selection [start, end): the new text
 *  and where the cursor goes. */
export function insertAt(text: string, start: number, end: number, entry: InsertEntry): { text: string; caret: number } {
  const mark = entry.text.indexOf("|");
  const plain = entry.text.replace("|", "");
  const next = text.slice(0, start) + plain + text.slice(end);
  return { text: next, caret: start + (mark < 0 ? plain.length : mark) };
}
