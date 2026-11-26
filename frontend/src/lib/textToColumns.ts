// Text to columns: split one text column of a worksheet into several columns by
// a delimiter. Pure; the commit (a NEW worksheet through the shared result
// contract, one undo step) is store/textToColumnsRun.ts, the dialog with its
// preview is components/Stage/worksheet/TextToColumnsDialog.tsx.
//
// Splitting rules, stated once:
// - The delimiter is a comma, tab, semicolon, space or any typed string
//   (matched literally, never as a pattern).
// - QUOTES: a field that starts with `"` runs to the closing `"` and may contain
//   the delimiter; `""` inside is one quote. A quote in the middle of a field is
//   ordinary text. Quote handling can be switched off.
// - EMPTY fields are kept (`a,,c` is three fields), so columns stay aligned.
//   "Merge repeated delimiters" drops the empty ones instead (a space-aligned
//   table). A cell with nothing in it is one empty field.
// - RAGGED rows are padded with empty fields to the widest row.
// - A split column is NUMERIC when every non-empty field reads as a number
//   (blank fields become missing values); otherwise it stays text, so no field
//   is ever coerced to NaN or lost.

import { toNumber } from "./fortranNumber";
import { trimCell } from "./clipboardTrim";
import type { DataStruct } from "./types";

export type DelimiterKind = "comma" | "tab" | "semicolon" | "space" | "custom";

export interface SplitOptions {
  delimiter: DelimiterKind;
  /** The typed string when `delimiter` is "custom". */
  custom?: string;
  /** Honour `"quoted, fields"`. Default true. */
  quote?: boolean;
  /** Strip spaces around every field. Default true. */
  trim?: boolean;
  /** Treat runs of the delimiter as one (drop empty fields). Default false. */
  merge?: boolean;
}

export const DELIMITER_LABELS: Record<DelimiterKind, string> = {
  comma: "Comma",
  tab: "Tab",
  semicolon: "Semicolon",
  space: "Space",
  custom: "Custom string",
};

/** Columns one split may create (a mistyped delimiter must not make hundreds). */
export const MAX_SPLIT_COLUMNS = 64;

/** The delimiter string, or an error sentence when a custom one is empty. */
export function delimiterText(o: Pick<SplitOptions, "delimiter" | "custom">): { text: string } | { error: string } {
  switch (o.delimiter) {
    case "comma": return { text: "," };
    case "tab": return { text: "\t" };
    case "semicolon": return { text: ";" };
    case "space": return { text: " " };
    case "custom": return o.custom ? { text: o.custom } : { error: "type the delimiter to split on" };
  }
}

/** One cell split into its fields. */
export function splitCell(cell: string, o: SplitOptions): string[] {
  const d = delimiterText(o);
  if ("error" in d) throw new Error(d.error);
  const delim = d.text;
  const quote = o.quote !== false;
  const fields: string[] = [];
  let i = 0;
  for (;;) {
    let field = "";
    if (quote && cell[i] === '"') {
      i++; // opening quote
      for (;;) {
        if (i >= cell.length) break; // unterminated: the rest is the field
        if (cell[i] === '"') {
          if (cell[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++; // closing quote
          break;
        }
        field += cell[i++];
      }
      // Anything between the closing quote and the delimiter is kept as text.
      const next = cell.indexOf(delim, i);
      const end = next < 0 ? cell.length : next;
      field += cell.slice(i, end);
      i = end;
    } else {
      const next = cell.indexOf(delim, i);
      const end = next < 0 ? cell.length : next;
      field = cell.slice(i, end);
      i = end;
    }
    fields.push(o.trim === false ? field : trimCell(field));
    if (i >= cell.length) break;
    i += delim.length; // the delimiter
    if (i >= cell.length) { fields.push(""); break; } // a trailing delimiter: one more empty field
  }
  return o.merge ? fields.filter((f) => f !== "") : fields;
}

export interface SplitTable {
  /** One row per cell, each padded to `width` with empty fields. */
  rows: string[][];
  width: number;
}

export function splitCells(cells: readonly string[], o: SplitOptions): SplitTable {
  const split = cells.map((c) => splitCell(c, o));
  const width = split.reduce((m, r) => Math.max(m, r.length), 0);
  return { rows: split.map((r) => [...r, ...Array<string>(width - r.length).fill("")]), width };
}

/** A split column, numeric or text. */
export type SplitColumn = { numeric: true; values: number[] } | { numeric: false; text: string[] };

/** Each column of `table` as numbers when all its non-empty fields are numbers. */
export function classifyColumns(table: SplitTable): SplitColumn[] {
  return Array.from({ length: table.width }, (_, c) => {
    const col = table.rows.map((r) => r[c]);
    const filled = col.filter((f) => f !== "");
    const nums = filled.map((f) => toNumber(f));
    if (filled.length > 0 && nums.every((n) => Number.isFinite(n))) {
      let k = 0;
      return { numeric: true, values: col.map((f) => (f === "" ? Number.NaN : nums[k++])) };
    }
    return { numeric: false, text: col };
  });
}

/** The worksheet with `textName`'s split appended: every existing column is
 *  carried unchanged (the source text column included: nothing is overwritten),
 *  numeric pieces become value columns, the rest text columns. Throws a plain
 *  sentence when the column is missing, the delimiter is empty, or the split
 *  would exceed MAX_SPLIT_COLUMNS. */
export function textToColumnsData(
  data: DataStruct,
  cells: readonly string[],
  textName: string,
  textLabel: string,
  textKey: "text_columns" | "origin_text_columns",
  o: SplitOptions,
): { data: DataStruct; created: number; numeric: number } {
  const table = splitCells(cells, o);
  if (table.width === 0) throw new Error("the column has no text to split");
  if (table.width > MAX_SPLIT_COLUMNS) throw new Error(`splitting would create ${table.width} columns (the limit is ${MAX_SPLIT_COLUMNS}): check the delimiter`);
  const cols = classifyColumns(table);
  const n = Math.max(data.time.length, cells.length);
  const taken = new Set([...data.labels, textName]);
  const fresh = (base: string): string => {
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base} (${k})`;
    taken.add(name);
    return name;
  };
  const numericCols = cols.flatMap((c, i) => (c.numeric ? [{ i, c }] : []));
  const names = numericCols.map(({ i }) => fresh(`${textLabel} ${i + 1}`));
  const values = Array.from({ length: n }, (_, r) => [
    ...data.labels.map((_l, c) => data.values[r]?.[c] ?? Number.NaN),
    ...numericCols.map(({ c }) => (c.numeric ? (c.values[r] ?? Number.NaN) : Number.NaN)),
  ]);
  const meta: Record<string, unknown> = { ...data.metadata };
  const sidecar: Record<string, unknown[]> = { ...((meta[textKey] as Record<string, unknown[]>) ?? {}) };
  const labels: Record<string, unknown> = { ...((meta["origin_text_column_labels"] as Record<string, unknown>) ?? {}) };
  cols.forEach((c, i) => {
    if (c.numeric) return;
    const short = fresh(`${textName}_${i + 1}`);
    sidecar[short] = Array.from({ length: n }, (_, r) => c.text[r] ?? "");
    labels[short] = { long_name: `${textLabel} ${i + 1}` };
  });
  meta[textKey] = sidecar;
  meta["origin_text_column_labels"] = labels;
  meta["worksheet_transform"] = "text-to-columns";
  meta["text_to_columns"] = { column: textName, delimiter: o.delimiter, custom: o.delimiter === "custom" ? o.custom : undefined, quote: o.quote !== false, trim: o.trim !== false, merge: o.merge === true };
  return {
    data: {
      ...data,
      time: Array.from({ length: n }, (_, r) => data.time[r] ?? Number.NaN),
      values,
      labels: [...data.labels, ...names],
      units: [...data.units, ...names.map(() => "")],
      metadata: meta,
    },
    created: cols.length,
    numeric: numericCols.length,
  };
}
