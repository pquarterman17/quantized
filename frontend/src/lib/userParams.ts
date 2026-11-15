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
// and it has a NAME: its own `name`, else the x-column cell (where a file puts
// the row's caption). An unnamed descriptive row is ambiguous -- no parameter,
// only a legend source. A repeated name keeps its FIRST row.
//
// Values are text. A value is numeric only when it starts with a plain number
// (`parseParamNumber`); anything else is never coerced.

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

function rowName(r: RawRow): string {
  const n = typeof r.name === "string" ? r.name : typeof r.x === "string" ? r.x : "";
  return n.trim();
}

/** The parameter rows of a dataset, in file/creation order. */
export function userParamRows(data: Pick<DataStruct, "metadata">): UserParamRow[] {
  const seen = new Set<string>();
  const out: UserParamRow[] = [];
  for (const r of rawRows(data.metadata)) {
    const name = rowName(r);
    if (r.role !== "label" || !name || seen.has(name) || typeof r.index !== "number" || !Array.isArray(r.cells)) continue;
    seen.add(name);
    out.push({ index: r.index, name, cells: r.cells.map((c) => (typeof c === "string" ? c : "")) });
  }
  return out;
}

/** A column's text value of parameter `name` ("" when unset). */
export function userParamValue(rows: readonly UserParamRow[], name: string, col: number): string {
  return rows.find((r) => r.name === name)?.cells[col]?.trim() ?? "";
}

/** The leading number of a parameter value ("300", "1e-3 T", "-5.5 K"); null
 *  when the value does not start with a plain number. `"5th"` is NOT numeric:
 *  the number must stand alone or be followed by whitespace. */
export function parseParamNumber(text: string): number | null {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?:\s+\S.*|%|\s*)$/.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

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
