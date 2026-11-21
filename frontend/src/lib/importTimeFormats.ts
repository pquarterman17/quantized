// The Import Wizard's per-column format choice for a time-only column
// (`12:30:01`, `1:05 PM`, `[h]:mm:ss`), the way Excel's Text Import Wizard
// sets a column's data format. Backend: `io/_time_of_day.py`. Pure helpers,
// so the alignment rules are unit-testable without React.

import type { ImportTimeFormat } from "./importTypes";
import type { ImportColumnRole, ImportPreviewColumn } from "./types";

/** `<Select>` options for a time column of `kind`, in the backend's
 *  `TIME_FORMATS` order. A duration has no time of day, so no clock. */
export function timeFormatOptions(kind: "clock" | "duration"): { value: ImportTimeFormat; label: string }[] {
  return kind === "duration"
    ? [
        { value: "seconds", label: "Duration (seconds)" },
        { value: "elapsed", label: "Elapsed from first row (s)" },
        { value: "text", label: "Text" },
      ]
    : [
        { value: "clock", label: "Time of day (HH:MM:SS axis)" },
        { value: "seconds", label: "Seconds since midnight" },
        { value: "elapsed", label: "Elapsed from first row (s)" },
        { value: "text", label: "Text" },
      ];
}

const NUMERIC_ROLES: ReadonlySet<ImportColumnRole> = new Set(["x", "y", "error"]);

/** The settings patch for choosing `format` on column `index`: every time
 *  column's format (raw-column aligned, `null` elsewhere) and the roles. A
 *  column turned to text that held a numeric role becomes a `label` (a text
 *  `y` would be all NaN); a text column turned numeric becomes the `x` axis
 *  when no other column is, else a `y`. An `ignore`d column stays ignored. */
export function withTimeFormat(
  columns: ImportPreviewColumn[],
  index: number,
  format: ImportTimeFormat,
): { time_formats: (ImportTimeFormat | null)[]; roles: ImportColumnRole[] } {
  const time_formats = columns.map((c, i) => (i === index ? format : c.time_format ?? null));
  const otherX = columns.some((c, i) => i !== index && c.role === "x");
  const roles = columns.map((c, i) => {
    if (i !== index || c.role === "ignore") return c.role;
    if (format === "text") return NUMERIC_ROLES.has(c.role) ? "label" : c.role;
    return NUMERIC_ROLES.has(c.role) ? c.role : otherX ? "y" : "x";
  });
  return { time_formats, roles };
}

/** A preview cell of a time-of-day column: the clock time it holds
 *  (`HH:MM:SS`, milliseconds when it has them), wrapping every 24 h like the
 *  plot's clock axis -- the date part of the ISO string is never shown. */
export function clockCell(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || Math.abs(seconds) > 8.64e12) return "";
  return new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23).replace(/\.000$/, "");
}

/** Whether the "unwrap across midnight" choice applies: some clock column
 *  is read as numbers. */
export function offersUnwrap(columns: readonly ImportPreviewColumn[]): boolean {
  return columns.some((c) => c.time_kind === "clock" && c.time_format !== undefined && c.time_format !== "text");
}
