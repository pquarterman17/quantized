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
import { parseExpr, printExpr, type Node } from "./derivedExprAst";
import { applyFormulasWithErrors, channelLetter } from "./formula";
import { resolveColumnNames } from "./formulaRefs";
import { editRefusalNotice, isRederived } from "./rederived";
import { linkSheets } from "./sheetRefs";
import type { Dataset } from "./types";

export type ScvTarget = { kind: "new" } | { kind: "column"; col: number };

export type TargetKind = "new" | "computed" | "data" | "x" | "categorical" | "readonly" | "loading";

/** Value columns before the computed ones. */
export const baseCountOf = (ds: Dataset): number => ds.data.labels.length - (ds.formulas?.length ?? 0);

/** What `target` is, or why nothing can be written to it now: a book whose
 *  full data is still loading (its row count and rows are the preview's), or a
 *  data column of a sheet that is rebuilt from its source. */
export function targetKind(ds: Dataset, target: ScvTarget): TargetKind {
  if (ds.pending != null) return "loading";
  if (target.kind === "new") return "new";
  if (target.col >= baseCountOf(ds)) return "computed";
  if (isRederived(ds)) return "readonly";
  if (target.col < 0) return "x";
  return isCategoricalChannel(ds.data, target.col) ? "categorical" : "data";
}

/** Can Apply write to a target of this kind? */
export const writable = (kind: TargetKind): boolean => kind !== "categorical" && kind !== "readonly" && kind !== "loading";

/** What applying does to this target, in words the dialog shows. */
export function targetNote(kind: TargetKind, ds: Dataset): string {
  switch (kind) {
    case "new":
      return "Adds a computed column. The formula stays on it and recalculates when its inputs change.";
    case "computed":
      return "Replaces this column's formula. It stays on the column and recalculates when its inputs change.";
    case "categorical":
      return "This is a categorical column; its cells are level codes. Write the formula to a new column instead.";
    case "readonly":
      return editRefusalNotice(ds);
    case "loading":
      return "The full data of this book is still loading, so its rows are not known yet. Apply is available as soon as it has loaded.";
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

type RangeIf = Extract<Node, { k: "if" }>;

/** The [from, to] of a range wrapper `if(row() >= a and row() <= b, f, nan)`,
 *  read from the syntax TREE, so it survives any respacing (a column delete
 *  re-serialises formulas token by token), or null when `n` is not one. */
function rangeOf(n: Node): { from: number; to: number; inner: Node } | null {
  if (n.k !== "if" || n.b.k !== "const" || n.b.name !== "nan" || n.c.k !== "and") return null;
  const bound = (c: Node, op: string): number | null =>
    c.k === "cmp" && c.op === op && c.a.k === "row" && c.b.k === "num" && Number.isInteger(c.b.v) ? c.b.v : null;
  const from = bound(n.c.a, ">=");
  const to = bound(n.c.b, "<=");
  return from === null || to === null ? null : { from, to, inner: (n as RangeIf).a };
}

/** A stored formula read back into the formula and range the dialog shows. */
export function unwrapRange(stored: string): { expr: string; from: string; to: string } {
  const plain = { expr: stored, from: "", to: "" };
  let tree: Node;
  try {
    tree = parseExpr(stored);
  } catch {
    return plain;
  }
  const r = rangeOf(tree);
  return r ? { expr: printExpr(r.inner), from: String(r.from), to: String(r.to) } : plain;
}

/** The formula a computed column stores for `expr` over `range`. A formula
 *  that already carries a range has it REPLACED, never nested inside the new
 *  one (nesting would intersect the two ranges). */
export function wrapRange(expr: string, range: RowRange, rows: number): string {
  const inner = unwrapRange(expr).expr;
  return isFull(range, rows) ? inner : `if(row() >= ${range.from} and row() <= ${range.to}, ${inner}, nan)`;
}

/** Do two formulas parse to the same tree (spacing and redundant brackets aside)? */
export function sameFormula(a: string, b: string): boolean {
  try {
    return printExpr(parseExpr(a)) === printExpr(parseExpr(b));
  } catch {
    return a.trim() === b.trim();
  }
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
  // A re-derived sheet's data columns are rebuilt from its source: not offered.
  const values = !isRederived(ds);
  return [
    ...(values ? [{ value: "-1", label: `X — ${xName || "X"} (values)` }] : []),
    ...ds.data.labels.flatMap((l, c) =>
      c >= base || values ? [{ value: String(c), label: `${channelLetter(c)} — ${l}${c >= base ? " (ƒx formula)" : isCategoricalChannel(ds.data, c) ? " (categorical)" : " (values)"}` }] : [],
    ),
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
  // The FIRST "|" is the caret marker; any later "|" is literal text.
  const mark = entry.text.indexOf("|");
  const plain = mark < 0 ? entry.text : entry.text.slice(0, mark) + entry.text.slice(mark + 1);
  const next = text.slice(0, start) + plain + text.slice(end);
  return { text: next, caret: start + (mark < 0 ? plain.length : mark) };
}
