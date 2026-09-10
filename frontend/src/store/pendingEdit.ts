// The ONE guard for "may this action mutate a dataset whose full data has not
// arrived yet?" (BUG-006 site 9's edit half.)
//
// WHY ITS OWN MODULE. Five review rounds on this feature produced four separate
// copies of this rule, and three of them were wrong at some point:
// `store/cellEdit.ts`, `useWorksheetView.pendingGuard`,
// `lib/workspaceDatasetParse.parsePending`, and `worksheet/textColumns.ts`. Every
// round that "fixed" it added a copy instead of a home. This is the home.
//
// THE INVARIANT. A pending dataset's `.data` is a read-only DISPLAY PROJECTION of
// the real book: `lib/bookData.installBookData` replaces `data` wholesale when the
// fetch lands, `WorksheetPane` kicks that fetch the moment the worksheet opens, and
// `resolvePendingDatasets` runs before every save. So anything written into `data`,
// `metadata`, `cat_levels` or `formulas` while pending is discarded — silently.
//
// NOT the same question as `lib/rowSidecars.rowsAreSampled`, which asks whether a
// row-INDEXED sidecar may be indexed against these numbers (false for a merely
// padding-trimmed prefix, whose cells line up). Round 3 unified the two because they
// looked alike and re-opened the data loss. Two questions, two predicates.
//
// KNOWN INCOMPLETE, DELIBERATELY — NOW HALF DONE. This refuses; it does not defer.
// A permanently failed fetch (moved source, expired upload token) leaves `pending`
// set forever, so the refusal is still a lockout — but it no longer LIES about it:
// `Dataset.pendingError` (BUG-009, recorded by `lib/bookData.installBookData`'s
// failure path) records why the last fetch failed, and the status this function
// sets says so, instead of promising a retry "in a moment" that cannot succeed.
//
// What remains is the DEFERRAL itself. The right shape is resolve-THEN-apply
// (`store/corrections.ts` already does it: `await get().resolveDataset(id)`
// first), wrapped so the safe path is the DEFAULT rather than something each new
// action must remember. That is a store-wide refactor, tracked in
// plans/BUGS_AND_ISSUES.md as BUG-009, and deliberately not attempted inside a
// PR that has already taken five review rounds.

import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";

/** Refuse a mutation of `ds` while its full data is still pending, and say why.
 *  Returns true when the caller must abort. Kicks the fetch so the retry the
 *  message suggests can succeed.
 *
 *  Call it BEFORE `recordHistory` and before any `set`, so a refused action leaves
 *  no undo entry and no macro line. */
export function refusePendingEdit(
  get: () => Pick<AppState, "ensureBookData" | "setStatus">,
  ds: Dataset,
  action: string,
): boolean {
  if (ds.pending == null) return false;
  // Still kick the fetch, even after a failure: a blip does come back, and the
  // recorded error is ADVISORY — it changes what the user is told, never what is
  // allowed, so nothing becomes unreachable.
  void get().ensureBookData(ds.id);
  get().setStatus(
    ds.pendingError == null
      ? `"${ds.name}" is still loading its full data — try ${action} again in a moment`
      : // BUG-009: a book that will never arrive used to get the same "in a
        // moment" as one arriving imminently, forever. Say what actually
        // happened and point at the fix instead of promising a retry.
        `"${ds.name}" could not load its full data (${ds.pendingError}) — ${action} needs the whole book. ` +
        `Retrying now; if it keeps failing, relink or re-import the source.`,
  );
  return true;
}
