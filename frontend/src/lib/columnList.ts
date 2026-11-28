// The column list view's rows (plan item 34): one line per worksheet column with what a reader
// scans a sheet for, derived from the same readers the grid header and the plot use, so the list
// cannot disagree with the sheet. Pure.
//
// Designation: the user's Set As choice or the book's own (lib/columnmeta.effectiveDesignations);
// otherwise an error binding says error, a label / ignore role says label / disregard, and the rest
// plot as Y, which is what the plot defaults do. The X column is X by definition.

import { channelLetter } from "./formula";
import { effectiveDesignations, type OriginDesignation } from "./columnmeta";
import { channelModelingType } from "./modeling";
import type { Dataset, ModelingType } from "./types";

export interface ColumnListRow {
  /** Channel index; -1 is the X column. */
  col: number;
  /** The formula-engine letter ("A", "B", ...), or "X". */
  letter: string;
  /** The column's name as the grid header shows it (the long name). */
  name: string;
  unit: string;
  designation: OriginDesignation;
  type: ModelingType;
  /** The column is a computed (formula) column. */
  formula: boolean;
  /** Rows with a value, and the sheet's row count. */
  filled: number;
  rows: number;
}

export function columnListRows(ds: Dataset): ColumnListRow[] {
  const { data } = ds;
  const rows = data.time.length;
  const base = data.labels.length - (ds.formulas?.length ?? 0);
  const designations = effectiveDesignations(data, ds.columnDesignations);
  const errorChannels = new Map((ds.errorRoles ?? []).map((b) => [b.channel, b.axis === "x" ? "X-error" : "Y-error"] as const));
  const meta = data.metadata ?? {};
  const xRow: ColumnListRow = {
    col: -1,
    letter: "X",
    name: String(meta["x_column_long"] || meta["x_column_name"] || "x"),
    unit: String(meta["x_column_unit"] ?? ""),
    designation: "X",
    type: "continuous",
    formula: false,
    filled: data.time.filter((v) => Number.isFinite(v)).length,
    rows,
  };
  const channels = data.labels.map((label, col): ColumnListRow => {
    const role = ds.channelRoles?.[col];
    const designation =
      designations[col] ?? errorChannels.get(col) ?? (role === "label" ? "label" : role === "ignore" ? "disregard" : "Y");
    return {
      col,
      letter: channelLetter(col),
      name: label,
      unit: data.units[col] ?? "",
      designation,
      type: channelModelingType(ds, col),
      formula: col >= base,
      filled: data.values.reduce((n, row) => n + (Number.isFinite(row[col]) ? 1 : 0), 0),
      rows,
    };
  });
  return [xRow, ...channels];
}
