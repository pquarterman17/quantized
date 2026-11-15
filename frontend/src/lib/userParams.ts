// Worksheet user-parameter header rows (Origin's "user parameters": a row of
// per-column values such as Temperature or Sample under the Long Name / Units /
// Comments rows). Pure — the store writes live in store/userParamActions.ts.
//
// STORAGE: a user parameter IS a descriptive header row, so it lives in the
// dataset's existing `metadata.label_rows` ({index, role:"label", x, cells},
// one cell per value channel — lib/labelRows.ts). That buys, with no new
// plumbing: the file's own descriptive rows (a CSV preamble row such as
// "Temperature,10,20,30") ARE parameters; the Inspector's "Legend from"
// picker already offers them; they survive .dwk save/load as part of the data;
// and a column insert / delete / move remaps the cells with the column
// (lib/worksheetColumnOps.ts). A row is a parameter when its role is "label"
// and it has a NAME: its own `name` (a row the user made), else, for a row read
// from a FILE, the x-column cell (where a file puts the row's caption) -- but only
// when that is unambiguous (`fileRowIsParam`): a title or date line with no
// values, a caption that is a column name, and a second header row (its cells
// abbreviate the header's) are NOT parameters, only legend sources. A repeated
// name keeps its FIRST row.
//
// Values are text. A value is numeric only when it starts with a plain number
// (`parseParamNumber`); anything else is never coerced.

import { firstNumber } from "./firstNumber";
import type { DataStruct } from "./types";

export interface UserParamRow {
  /** The row's identity in `metadata.label_rows`. */
  index: number;
  name: string;
  /** One text cell per value channel (may be shorter than the channel count). */
  cells: string[];
}

type RawRow = Record<string, unknown> & { index?: unknown; role?: unknown; name?: unknown; x?: unknown; cells?: unknown };

function rawRows(meta: Record<string, unknown> | undefined): RawRow[] {
  const rows = meta?.["label_rows"];
  return Array.isArray(rows) ? rows.filter((r): r is RawRow => !!r && typeof r === "object") : [];
}

const alnum = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when `cell` can be an abbreviation of `full` (its letters and digits
 *  appear in order within it): "M1" of "Moment 1". */
function abbreviates(cell: string, full: string): boolean {
  const a = alnum(cell);
  const f = alnum(full);
  let i = 0;
  for (const ch of f) if (i < a.length && ch === a[i]) i++;
  return a.length > 0 && i === a.length;
}

/** Whether a descriptive row read from a FILE (no explicit `name`) is
 *  unambiguously a parameter: it has a caption AND at least one value (a title
 *  or date line has none), the caption is not one of the dataset's column
 *  names, and its values are not just a second header row (every value an
 *  abbreviation of its column's own name). Anything doubtful is not promoted. */
function fileRowIsParam(r: RawRow, caption: string, data: Pick<DataStruct, "metadata"> & { labels?: readonly string[] }): boolean {
  const cells = (r.cells as unknown[]).map((c) => (typeof c === "string" ? c.trim() : ""));
  if (!cells.some(Boolean)) return false;
  const meta = data.metadata ?? {};
  const names = [meta["x_column_name"], meta["x_column_long"], ...(Array.isArray(meta["all_column_names"]) ? meta["all_column_names"] : []), ...(data.labels ?? [])];
  if (names.some((n) => typeof n === "string" && alnum(n) === alnum(caption))) return false;
  const labels = data.labels ?? [];
  const filled = cells.map((c, i) => [c, labels[i] ?? ""] as const).filter(([c]) => c);
  return !(filled.length > 0 && filled.every(([c, l]) => l && abbreviates(c, l)));
}

function rowName(r: RawRow): string {
  const n = typeof r.name === "string" ? r.name : typeof r.x === "string" ? r.x : "";
  return n.trim();
}

/** The parameter rows of a dataset, in file/creation order. */
export function userParamRows(data: Pick<DataStruct, "metadata"> & { labels?: readonly string[] }): UserParamRow[] {
  const seen = new Set<string>();
  const out: UserParamRow[] = [];
  for (const r of rawRows(data.metadata)) {
    const name = rowName(r);
    if (r.role !== "label" || !name || seen.has(name) || typeof r.index !== "number" || !Array.isArray(r.cells)) continue;
    if (typeof r.name !== "string" && !fileRowIsParam(r, name, data)) continue;
    seen.add(name);
    out.push({ index: r.index, name, cells: r.cells.map((c) => (typeof c === "string" ? c : "")) });
  }
  return out;
}

/** A column's text value of parameter `name` ("" when unset). */
export function userParamValue(rows: readonly UserParamRow[], name: string, col: number): string {
  return rows.find((r) => r.name === name)?.cells[col]?.trim() ?? "";
}

/** The number a parameter value carries: the first number in its text, read
 *  exactly as the gradient's "Number in legend" does ("300K" -> 300,
 *  "1e-3 T" -> 0.001), so ordering by a parameter and colouring by the same
 *  legend text agree. Null when the value has none. */
export const parseParamNumber = firstNumber;

/** `label_rows` with parameter `name` set to `text` for channel `col` (the row
 *  is created, padded to `width`, when new). A blank `text` clears the cell. */
export function withParamCell(
  meta: Record<string, unknown> | undefined,
  name: string,
  col: number,
  text: string,
  width: number,
): unknown[] {
  const rows = rawRows(meta);
  const hit = rows.find((r) => r.role === "label" && rowName(r) === name);
  const pad = (cells: unknown[]): string[] =>
    Array.from({ length: Math.max(width, cells.length, col + 1) }, (_, i) => (typeof cells[i] === "string" ? (cells[i] as string) : ""));
  if (hit) {
    return rows.map((r) =>
      r === hit
        ? { ...r, name, x: typeof r.x === "string" && r.x ? r.x : name, cells: pad(Array.isArray(r.cells) ? r.cells : []).map((c, i) => (i === col ? text.trim() : c)) }
        : r,
    );
  }
  const index = rows.reduce((m, r) => (typeof r.index === "number" ? Math.max(m, r.index) : m), -1) + 1;
  const cells = pad([]).map((c, i) => (i === col ? text.trim() : c));
  return [...rows, { index, role: "label", name, x: name, cells }];
}

/** `label_rows` without parameter `name`. */
export function withoutParam(meta: Record<string, unknown> | undefined, name: string): unknown[] {
  return rawRows(meta).filter((r) => !(r.role === "label" && rowName(r) === name));
}

const TOKEN = /\{([^{}]+)\}/g;

/** A legend label for column `col` from a template: `{Name}` is that column's
 *  value of parameter Name; `{label}`, `{unit}` and `{comment}` are the column's
 *  own Long Name, Units and Comments (a parameter of the same name wins).
 *  Fail closed: an unknown name, or a parameter with no value on this column,
 *  gives `{ error }` -- never a label with a hole in it. */
export function expandParamTemplate(
  template: string,
  data: DataStruct,
  col: number,
  comment: string,
): { text: string } | { error: string } {
  const rows = userParamRows(data);
  let error: string | null = null;
  const text = template.replace(TOKEN, (_, raw: string) => {
    const name = raw.trim();
    let v: string | undefined;
    if (rows.some((r) => r.name === name)) v = userParamValue(rows, name, col);
    else if (name === "label") v = data.labels[col] ?? "";
    else if (name === "unit") v = data.units[col] ?? "";
    else if (name === "comment") v = comment;
    else {
      error ??= `unknown parameter {${name}}`;
      return "";
    }
    if (!v) error ??= `no {${name}} value`;
    return v ?? "";
  });
  return error ? { error } : { text: text.trim() };
}

/** `cols` ordered by the numeric value of parameter `name` (ascending, or
 *  descending); a column whose value is blank or non-numeric is never guessed
 *  at -- it keeps its relative order after every numeric one and is counted in
 *  `unordered`. Ties keep their given order. */
export function orderColumnsByParam(
  data: Pick<DataStruct, "metadata">,
  name: string,
  cols: readonly number[],
  dir: 1 | -1,
): { order: number[]; unordered: number } {
  const rows = userParamRows(data);
  const keyed = cols.map((c, i) => ({ c, i, v: parseParamNumber(userParamValue(rows, name, c)) }));
  const numeric = keyed.filter((k) => k.v !== null).sort((a, b) => dir * ((a.v as number) - (b.v as number)) || a.i - b.i);
  const rest = keyed.filter((k) => k.v === null);
  return { order: [...numeric, ...rest].map((k) => k.c), unordered: rest.length };
}
