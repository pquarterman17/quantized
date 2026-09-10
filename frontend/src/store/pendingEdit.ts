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
// KNOWN INCOMPLETE, DELIBERATELY. This refuses; it does not defer. A permanently
// failed fetch (moved source, expired upload token) leaves `pending` set forever, so
// the refusal becomes a permanent lockout while the message still says "in a moment".
// The right shape is resolve-THEN-apply (`store/corrections.ts` already does it:
// `await get().resolveDataset(id)` first), wrapped so the safe path is the DEFAULT
// rather than something each new action must remember. That is a store-wide
// refactor, tracked in plans/BUGS_AND_ISSUES.md as BUG-009, and deliberately not
// attempted inside a PR that has already taken five review rounds.

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
  void get().ensureBookData(ds.id);
  get().setStatus(`"${ds.name}" is still loading its full data — try ${action} again in a moment`);
  return true;
}
