// One definition of "the worksheet as a table" for everything that takes the
// sheet OUT of the app: the ⧉ Copy button (TSV on the clipboard) and
// "Export worksheet…" (CSV / TSV / Excel, io/table_export.py).
//
// Worksheet audit #6/#8: Copy and the consolidated CSV dropped text columns,
// a date X went out as epoch seconds, and the only full-sheet file had no
// units row. Here every column the grid holds is a table column — the X, each
// value channel and each text column — in the FILE's column order
// (`metadata.all_column_names`, which the importers record) rather than
// "numbers first, text after"; a date X is a date; a categorical channel
// writes its level names. Copy and Export read the same columns, so the
// clipboard and the file cannot disagree.

import type { TableColumnKind, TableColumnWire } from "../../../lib/api/worksheetExport";
import { categoricalLevels } from "../../../lib/categorical";
import { clipboardCellText } from "../../../lib/clipboardGrid";
import type { Dataset } from "../../../lib/types";
import { fmtDateCell } from "./cellFormat";
import { worksheetTextColumns } from "./textColumns";

/** One column of the table: what to call it and where its cells come from. */
export interface TableColumnPlan {
  name: string;
  unit: string;
  kind: TableColumnKind;
  /** -1 = the X column, >= 0 a value channel; absent for a text column. */
  channel?: number;
  /** A text column's cells (one per row). */
  text?: readonly string[];
}

const UNIT_SUFFIX = /\s*[([][^)\]]*[)\]]\s*$/;

/** A header as the importers split it: "Temp (K)" and "Temp" name one column. */
function bare(name: string): string {
  return name.replace(UNIT_SUFFIX, "").trim();
}

/** Every column of `ds` in worksheet order. `skipDisregard`: leave out the
 *  channels the user Set As "Disregard" (Origin's "not data" designation). */
export function worksheetTableColumns(ds: Dataset, skipDisregard = false): TableColumnPlan[] {
  const { labels, units, metadata } = ds.data;
  const xIsDate = metadata?.time_is_datetime === true;
  const cols: TableColumnPlan[] = [
    {
      name: String(metadata?.["x_column_long"] || metadata?.["x_column_name"] || "x"),
      unit: String(metadata?.["x_column_unit"] ?? ""),
      kind: xIsDate ? "datetime" : "number",
      channel: -1,
    },
    ...labels.flatMap((label, c): TableColumnPlan[] =>
      skipDisregard && ds.columnDesignations?.[c] === "disregard"
        ? []
        : [{ name: label, unit: units[c] ?? "", kind: categoricalLevels(ds.data, c) ? "text" : "number", channel: c }],
    ),
    ...worksheetTextColumns(ds.data, ds.pending).map((t): TableColumnPlan => ({
      name: t.longName ?? t.shortName,
      unit: t.unit ?? "",
      kind: "text",
      text: t.rows,
    })),
  ];
  return inFileOrder(cols, metadata?.["all_column_names"], metadata?.["origin_column_names"]);
}

/** `cols` reordered to the file's own column order when the importer recorded
 *  it; a column the file did not have (a formula column) keeps its place
 *  after the one before it. Stable, and the identity without a record. */
function inFileOrder(cols: TableColumnPlan[], allNames: unknown, originNames: unknown): TableColumnPlan[] {
  if (!Array.isArray(allNames) || Array.isArray(originNames)) return cols; // Origin books keep their own order
  const free = new Map<string, number[]>();
  allNames.forEach((n, i) => {
    const key = bare(String(n));
    free.set(key, [...(free.get(key) ?? []), i]);
  });
  let last = -1;
  const keyed = cols.map((col, k) => {
    const slots = free.get(bare(col.name));
    const pos = slots?.shift();
    last = pos ?? last + 1e-3; // unknown: just after the previous column
    return { col, pos: last, k };
  });
  return keyed.sort((a, b) => a.pos - b.pos || a.k - b.k).map((e) => e.col);
}

/** Row `r`'s cell in column `col`, for a file: numbers as numbers, a date as
 *  epoch seconds (the writer formats it), text as text, blank as null. */
function fileCell(ds: Dataset, col: TableColumnPlan, r: number): number | string | null {
  if (col.text) return col.text[r] ?? "";
  const ch = col.channel ?? -1;
  const v = ch < 0 ? ds.data.time[r] : ds.data.values[r]?.[ch];
  const levels = ch >= 0 ? categoricalLevels(ds.data, ch) : null;
  if (levels) return clipboardCellText(v, levels);
  return v != null && Number.isFinite(v) ? v : null;
}

/** The export wire columns for `rows` (source row indices, in order). */
export function worksheetTableWire(ds: Dataset, rows: readonly number[], skipDisregard = false): TableColumnWire[] {
  return worksheetTableColumns(ds, skipDisregard).map((col) => ({
    name: col.name,
    unit: col.unit,
    kind: col.kind,
    cells: rows.map((r) => fileCell(ds, col, r)),
  }));
}

/** What Copy puts on the clipboard for `rows`: a header of one "Name (unit)"
 *  cell per column — what Excel and Origin take as a header row, and what our
 *  paste reads units back from — and each row as the grid shows it (level
 *  names, a date X as a date, blank for missing). Columns are planned once. */
export function worksheetTsvTable(ds: Dataset, rows: readonly number[]): { headers: string[]; data: string[][] } {
  const cols = worksheetTableColumns(ds);
  return {
    headers: cols.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name)),
    data: rows.map((r) =>
      cols.map((col) => {
        const v = fileCell(ds, col, r);
        if (col.kind === "datetime") return typeof v === "number" ? fmtDateCell(v) : "";
        return typeof v === "number" ? clipboardCellText(v) : (v ?? "");
      }),
    ),
  };
}
