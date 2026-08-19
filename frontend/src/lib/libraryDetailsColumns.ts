// Selectable Details-view metadata columns (LIBRARY_WORKBOOK_UX_PLAN PR L,
// L0.56 "Details view supports selectable metadata columns"). A bounded,
// discoverable set — Name stays mandatory (it's the row's identity, not a
// metadata column); every other column is a user-visible toggle. The
// original seven (shipped with PR D/D2) default ON so an existing session's
// Details view renders unchanged until the user opens the picker; the three
// project-metadata columns this PR adds (sample/notes/group) default OFF —
// discoverable, not sprung on an already-familiar table.

import type { LibraryDetailsSortKey } from "./libraryDetails";

export type LibraryDetailsColumnKey = Exclude<LibraryDetailsSortKey, "manual" | "name">;

export interface LibraryDetailsColumnDef {
  key: LibraryDetailsColumnKey;
  label: string;
  className?: string;
  defaultVisible: boolean;
}

export const LIBRARY_DETAILS_COLUMNS: readonly LibraryDetailsColumnDef[] = [
  { key: "type", label: "Type", defaultVisible: true },
  { key: "location", label: "Folder / workbook", className: "qzk-details-wide", defaultVisible: true },
  { key: "dimensions", label: "Rows × cols", className: "qzk-details-medium", defaultVisible: true },
  { key: "dataType", label: "Data type", className: "qzk-details-wide", defaultVisible: true },
  { key: "source", label: "Source", className: "qzk-details-medium", defaultVisible: true },
  { key: "modified", label: "Imported / modified", className: "qzk-details-wide", defaultVisible: true },
  { key: "tags", label: "Tags", className: "qzk-details-wide", defaultVisible: true },
  { key: "sample", label: "Sample", className: "qzk-details-wide", defaultVisible: false },
  { key: "notes", label: "Notes", className: "qzk-details-wide", defaultVisible: false },
  { key: "group", label: "Group", className: "qzk-details-medium", defaultVisible: false },
];

export function defaultVisibleDetailsColumns(): Set<LibraryDetailsColumnKey> {
  return new Set(LIBRARY_DETAILS_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
}

/** Same default set as `defaultVisibleDetailsColumns`, as an ORDERED array —
 *  the shape `.dwk` persistence (lib/workspace.ts) and the store round-trip,
 *  since a `Set`'s iteration order isn't a contract worth leaning on across a
 *  JSON boundary. */
export function defaultVisibleDetailsColumnKeys(): LibraryDetailsColumnKey[] {
  return LIBRARY_DETAILS_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
}

const KNOWN_COLUMN_KEYS = new Set<string>(LIBRARY_DETAILS_COLUMNS.map((c) => c.key));

/** PR L slice 2 (L0.56's "persist the Details column selection"): sanitize a
 *  `.dwk`-loaded column list the same defensive way `sanitizeCollections`/
 *  `sanitizeSmartFolders` treat their own arrays — drop anything that isn't a
 *  recognized column key (a hand-edited doc, or a key retired since the doc
 *  was saved), never throw. `undefined`/malformed input (an older doc, or one
 *  with no field at all) falls back to today's seven-column default so an
 *  existing session's table renders unchanged. */
export function sanitizeVisibleDetailsColumns(value: unknown): LibraryDetailsColumnKey[] {
  if (!Array.isArray(value)) return defaultVisibleDetailsColumnKeys();
  const kept = value.filter((v): v is LibraryDetailsColumnKey => typeof v === "string" && KNOWN_COLUMN_KEYS.has(v));
  return kept;
}
