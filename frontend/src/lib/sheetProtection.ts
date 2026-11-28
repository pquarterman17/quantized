// Sheet protection WITHOUT a password (plan item 34; OG1 keeps passwords out). A protected worksheet
// refuses edits to itself: cell edits, paste, fill, clear, sort, insert / delete / move of rows and
// columns, header edits, formula changes, Set Column Values, recode, re-import and the like. Viewing,
// copying, plotting, analysis and exporting stay allowed, and a formula column still recalculates when
// its source changes (that is not an edit of this sheet). Unprotecting is one click.
//
// It is one boolean on the dataset (`Dataset.protectedSheet`). The refusal rides the same question every
// edit path already asks of a re-derived sheet (`isRederived` / `editRefusalNotice`,
// lib/rederivedChecks.ts), so a path cannot be forgotten by one that exists today; the few paths that
// did not ask are listed, with their tests, in store/sheetProtection.test.ts.
//
// Forward compatibility (lib/workspaceForwardCompat.ts): an older release that does not know the field
// drops it on open and save, which loses only the lock, never data, so it is "safe-drop" and does NOT
// gate the file (contrast cell notes, which an older release would misplace on a row operation).

import type { Dataset } from "./types";

/** Short on purpose: store/computedColumns.ts says it from the eager entry chunk. */
export const PROTECTED_NOTICE = "This sheet is protected: unprotect it (Columns > Unprotect sheet) to edit it";

export const isSheetProtected = (ds: Pick<Dataset, "protectedSheet">): boolean => ds.protectedSheet === true;

/** The refusal for `ds`, or null when it can be edited. Pure; the caller says it (status line and toast). */
export const protectionRefusal = (ds: Pick<Dataset, "protectedSheet"> | undefined): string | null =>
  ds && ds.protectedSheet === true ? PROTECTED_NOTICE : null;

/** The first protected worksheet among `ids`, or undefined. A Library rename or delete of a protected sheet is refused
 *  with the reason (Trash counts as a delete); Unprotect is one click. */
export const protectedAmong = (datasets: readonly Pick<Dataset, "id" | "name" | "protectedSheet">[], ids: readonly string[]) =>
  datasets.find((d) => d.protectedSheet === true && ids.includes(d.id));

/** True (after saying why in the status line) when any of `ids` is protected: the caller stops. One copy of the
 *  refusal for every store path that renames, deletes or retypes whole sheets. */
export function refuseProtected(s: { datasets: readonly Dataset[]; setStatus: (m: string) => void }, ids: readonly string[]): boolean {
  const d = protectedAmong(s.datasets, ids);
  if (d) s.setStatus(`${d.name}: ${PROTECTED_NOTICE}`);
  return !!d;
}
