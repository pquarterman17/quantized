import type { DataStruct } from "./types";
import type { OriginDesignation } from "./columnmeta";
import { textColumnEntries } from "./originTextColumnCells";

export const DESIGNATION_BADGE: Record<OriginDesignation, string> = {
  X: "X",
  Y: "Y",
  "Y-error": "yEr",
  "X-error": "xEr",
  label: "Label",
  disregard: "Disregard",
  Z: "Z",
};

/** One Origin inline-text column. Text cells stay outside the numeric value
 * matrix and are therefore display/join/encoding metadata, not plot channels. */
export interface TextColumn {
  shortName: string;
  rows: string[];
  /** Origin's Long Name / Units for the column, when the book has them
   *  (`metadata.origin_text_column_labels`, keyed by short name). */
  longName?: string;
  unit?: string;
}

function textColumnLabels(ds: DataStruct): Record<string, { long_name?: unknown; unit?: unknown }> {
  const raw = (ds.metadata ?? {})["origin_text_column_labels"];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, { long_name?: unknown; unit?: unknown }>) : {};
}

export function originTextColumns(ds: DataStruct): TextColumn[] {
  const labels = textColumnLabels(ds);
  return textColumnEntries(ds).map(([shortName, rows]) => {
    const l = Object.hasOwn(labels, shortName) ? labels[shortName] : undefined;
    const longName = typeof l?.long_name === "string" && l.long_name ? l.long_name : undefined;
    const unit = typeof l?.unit === "string" && l.unit ? l.unit : undefined;
    return { shortName, rows: rows.map(String), ...(longName ? { longName } : {}), ...(unit ? { unit } : {}) };
  });
}

/** Whether unresolved Origin report-sheet residue is available in metadata. */
export function hasOriginReportSheets(ds: DataStruct): boolean {
  const raw = (ds.metadata ?? {})["origin_report_sheets"];
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0;
}
