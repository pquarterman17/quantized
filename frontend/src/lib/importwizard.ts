// Pure helpers for the import wizard workshop (ORIGIN_GAP_PLAN #40). Kept
// separate from the state hook so the array-alignment / label-composition
// logic is unit-testable without React.

import type {
  ImportColumnRole,
  ImportPreviewColumn,
  ImportSettingsWire,
} from "./types";

/** Mirrors `quantized.io.import_preview.DATA_ROLES` exactly. */
export const IMPORT_COLUMN_ROLES: ImportColumnRole[] = [
  "x",
  "y",
  "error",
  "label",
  "ignore",
];

/** `<Select>` options for a column's role. */
export const ROLE_OPTIONS: { value: ImportColumnRole; label: string }[] = [
  { value: "x", label: "x (axis)" },
  { value: "y", label: "y" },
  { value: "error", label: "error" },
  { value: "label", label: "label" },
  { value: "ignore", label: "ignore" },
];

/** Named delimiter aliases the wizard offers — mirrors
 *  `import_preview._NAMED_DELIMS`'s user-facing subset (raw literal
 *  delimiters, e.g. a stray `;` typed by hand, still pass straight through
 *  server-side, so this list is a convenience, not an exhaustive contract). */
export const DELIMITER_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "auto-detect" },
  { value: "comma", label: "comma  ," },
  { value: "tab", label: "tab" },
  { value: "semicolon", label: "semicolon  ;" },
  { value: "pipe", label: "pipe  |" },
  { value: "whitespace", label: "whitespace" },
];

/** A fresh starting `ImportSettings` before any file is picked (unused by the
 *  wizard directly — `guess_settings` always supplies the real first value —
 *  but useful as a defensive fallback / test fixture). */
export const EMPTY_IMPORT_SETTINGS: ImportSettingsWire = {
  delimiter: "auto",
  header_line: null,
  units_line: null,
  data_start_line: 0,
  column_names: null,
  roles: null,
};

/** The filename's extension including the dot (`"run1.DAT"` -> `".DAT"`), or
 *  `""` if there isn't one. */
export function fileExtension(filename: string): string {
  const m = /\.[^.\\/]+$/.exec(filename);
  return m ? m[0] : "";
}

/** Default "save as filter" name: the filename without its extension. */
export function defaultFilterName(filename: string): string {
  const ext = fileExtension(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

/** Default glob for "save as filter": every file sharing this extension. */
export function defaultGlob(filename: string): string {
  const ext = fileExtension(filename);
  return ext ? `*${ext}` : "*";
}

// These three all rebuild their array FROM the live preview's resolved
// `columns` (never from `settings.roles` / `settings.column_names` directly)
// so an edit to ONE column can't silently drop another column's already-
// resolved role/unit — `preview.columns[i]` is the true current value
// (backend-resolved: defaults applied, `units_line` already overlaid, etc.),
// while the raw settings arrays may be `null`, short, or missing the units
// a units_line row supplies. Always send a full, `columns.length`-long array.

/** Roles array (one per `columns` entry) with index `i` set to `role`. */
export function withRole(
  columns: ImportPreviewColumn[],
  index: number,
  role: ImportColumnRole,
): ImportColumnRole[] {
  return columns.map((c, i) => (i === index ? role : c.role));
}

/** `"Name (unit)"` (backend `_extract_units` syntax) or plain `"Name"` when
 *  `unit` is blank. Composing name+unit into one string is required because
 *  `ImportSettings` carries only `column_names` — there is no separate
 *  per-column unit field (see `io/import_preview.py::_parse_core`). */
export function composeColumnLabel(name: string, unit: string): string {
  const n = name.trim() || "Col";
  const u = unit.trim();
  return u ? `${n} (${u})` : n;
}

/** `column_names` array (one per `columns` entry) with index `i` renamed. */
export function withColumnName(
  columns: ImportPreviewColumn[],
  index: number,
  name: string,
): string[] {
  return columns.map((c, i) => composeColumnLabel(i === index ? name : c.name, c.unit));
}

/** `column_names` array (one per `columns` entry) with index `i` re-unit'd. */
export function withColumnUnit(
  columns: ImportPreviewColumn[],
  index: number,
  unit: string,
): string[] {
  return columns.map((c, i) => composeColumnLabel(c.name, i === index ? unit : c.unit));
}

/** Parse a "line index" text field: blank -> `null` (no such line), else the
 *  finite integer, else `null` (an in-progress edit like `"-"` doesn't crash). */
export function parseLineField(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
