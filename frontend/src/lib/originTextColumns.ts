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
}

export function originTextColumns(ds: DataStruct): TextColumn[] {
  return textColumnEntries(ds).map(([shortName, rows]) => ({ shortName, rows: rows.map(String) }));
}

/** Whether unresolved Origin report-sheet residue is available in metadata. */
export function hasOriginReportSheets(ds: DataStruct): boolean {
  const raw = (ds.metadata ?? {})["origin_report_sheets"];
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0;
}
