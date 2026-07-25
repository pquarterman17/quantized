// Selectable legend-label sources (MAIN_PLAN #33).
//
// A lab file often describes its columns on SEVERAL rows — column name, units,
// sample id, applied field — and which one deserves to be the legend depends on
// the plot, not on the file. The parser used to keep exactly one (whichever sat
// directly above the data) and drop the rest, so a four-row header left the user
// with an arbitrary choice and no way back to the sample ids.
//
// `io/delimited.py` now preserves them all as `metadata.label_rows`, already
// reduced to the VALUE CHANNELS (the x column is split out into `x`), so
// nothing here has to redo the column->channel mapping. This module is the pure
// read side: list what a dataset offers, and turn a chosen row into the
// `seriesLabels` override map the legend already consumes.

import type { DataStruct } from "./types";

export interface LabelRow {
  /** Row index in the original file — the stable identity of the choice. */
  index: number;
  /** What layout detection made of it: the row it used as column names
   *  ("header"), the row it read as units ("units"), or an extra descriptive
   *  row it would previously have discarded ("label"). */
  role: "header" | "units" | "label";
  /** This row's cell for the x column ("" when x is a synthesized index). */
  x: string;
  /** One cell per value channel, index-aligned with `DataStruct.labels`. */
  cells: string[];
}

function isLabelRow(v: unknown): v is LabelRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<LabelRow>;
  return (
    typeof r.index === "number" &&
    Array.isArray(r.cells) &&
    r.cells.every((c) => typeof c === "string")
  );
}

/** The label rows a dataset offers, or [] when it has none (an ordinary
 *  single-header CSV, or any other parser). */
export function labelRows(data: DataStruct): LabelRow[] {
  const raw = (data.metadata ?? {})["label_rows"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isLabelRow).map((r) => ({
    index: r.index,
    role: r.role === "header" || r.role === "units" ? r.role : "label",
    x: typeof r.x === "string" ? r.x : "",
    cells: r.cells,
  }));
}

/** A short menu label: the row's own content is the most recognizable thing
 *  about it ("NbAu-1, NbAu-2, …"), far more than "row 3". */
export function describeLabelRow(row: LabelRow, maxCells = 3): string {
  const shown = row.cells.filter(Boolean).slice(0, maxCells);
  const more = row.cells.filter(Boolean).length - shown.length;
  const preview = shown.join(", ") + (more > 0 ? `, +${more}` : "");
  const suffix = row.role === "header" ? " (current)" : row.role === "units" ? " (units)" : "";
  return (preview || `row ${row.index + 1}`) + suffix;
}

/** Turn a chosen row into `seriesLabels` overrides.
 *
 *  BLANK CELLS ARE SKIPPED rather than written as "": a descriptive row is
 *  often sparse (only the measured columns carry a sample id), and blanking a
 *  channel's legend entry would be a strictly worse label than the one the
 *  parser already derived. */
export function labelsFromRow(row: LabelRow): Record<number, string> {
  const out: Record<number, string> = {};
  row.cells.forEach((cell, channel) => {
    const text = cell.trim();
    if (text) out[channel] = text;
  });
  return out;
}
