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
