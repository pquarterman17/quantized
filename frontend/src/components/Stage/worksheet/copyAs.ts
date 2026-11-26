// A rectangular selection as the grid DISPLAYS it, for "Copy as displayed" and
// "Copy as table". The default Copy writes full precision (it must round-trip
// into a paste); these write what is on screen: each column's display format
// (Column Properties, the Numbers prefs, the grid's own per-column precision),
// a categorical column's level names, a date X as a date.
//
// Pure over a dataset: the same `gridFormatters` the grid renders with, so the
// copy cannot disagree with the screen. A missing or non-finite cell is an
// empty field, not the grid's em-dash (an em-dash pasted into Excel is text).

import { categoricalLevels } from "../../../lib/categorical";
import { clipboardCellText } from "../../../lib/clipboardGrid";
import type { Dataset } from "../../../lib/types";
import { gridFormatters } from "./cellFormat";

export interface DisplayedBlock {
  /** One "Name (unit)" per column, as Copy rows writes its header. */
  headers: string[];
  /** One row per source row, one displayed string per column. */
  grid: string[][];
}

function headerOf(ds: Dataset, col: number): string {
  const meta = ds.data.metadata ?? {};
  const name = col < 0 ? String(meta["x_column_long"] || meta["x_column_name"] || "x") : (ds.data.labels[col] ?? `column ${col + 1}`);
  const unit = col < 0 ? String(meta["x_column_unit"] ?? "") : (ds.data.units[col] ?? "");
  return unit ? `${name} (${unit})` : name;
}

/** `rows` (source row indices, in the order to write) x `cols` (-1 = X). */
export function displayedBlock(ds: Dataset, rows: readonly number[], cols: readonly number[]): DisplayedBlock {
  const { time, values, metadata } = ds.data;
  const xIsDate = metadata?.time_is_datetime === true || (metadata?.time_is_clock === true && "clock");
  const fmtOf = gridFormatters(time, values, ds.columnProps, xIsDate);
  const formats = cols.map((c) => fmtOf(c));
  const levels = cols.map((c) => (c >= 0 ? categoricalLevels(ds.data, c) : null));
  const grid = rows.map((r) =>
    cols.map((c, k) => {
      const v = c < 0 ? time[r] : values[r]?.[c];
      if (v == null || !Number.isFinite(v)) return "";
      const lv = levels[k];
      return lv ? clipboardCellText(v, lv) : formats[k](v);
    }),
  );
  return { headers: cols.map((c) => headerOf(ds, c)), grid };
}
