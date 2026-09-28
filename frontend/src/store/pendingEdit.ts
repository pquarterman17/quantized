// The ONE boundary for "may this action touch a dataset whose full data has not
// arrived yet?" (BUG-006 site 9's edit half; BUG-009's resolve-then-apply.)
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
// ONE POLICY, TWO CALL SHAPES (BUG-009, 2026-09-28). `withResolved` is the policy:
// resolve the book, THEN apply, and on failure say what happened and offer the
// recovery. `resolvePendingEdit` is the same policy for a SYNCHRONOUS store action
// — it returns false for a loaded dataset so the caller applies inline, unchanged,
// and schedules the apply through `withResolved` otherwise. The old third shape,
// `refusePendingEdit`, is gone: it refused without deferring, and a book whose
// fetch had failed for good (moved source, expired upload token) stays `pending`
// (`installBookData` records the reason and keeps the fetch reference for a retry),
// so every refused edit, extract and copy was refused forever while its status
// promised "try again in a moment". Its last caller (`derivedColumnRun.ts`, P2.5)
// arrived AFTER the migration that retired the others had declared none left —
// which is exactly why the safe path must be the only one on offer.
//
// A FAILED LOAD IS NOT A DEAD END. The status names the reason and says nothing
// changed; a danger toast offers Re-import (`store/reimport.ts`), which re-reads the
// source and clears `pending` on success — or, for a source the desktop shell
// confirms missing or offline, says so and opens Relink, which now re-points the
// book's fetch as well as its recorded source (`store/relinkCommit.ts`).
// The reason itself lives in `lib/bookData.ts`'s module scope beside the in-flight
// registry, NOT on `Dataset` — see its comment for the request storm and the starved
// autosave that putting it on `Dataset` caused.

import { lastBookError, sameBookSource, truncateReason } from "../lib/bookData";
import type { Dataset } from "../lib/types";
// `toast` ONLY: a dozen suites `vi.mock` ./toasts with nothing else, and a
// missing mock export throws on access — inside a fetch's failure handler.
import { toast, type ToastOptions } from "./toasts";
import type { AppState } from "./useApp";

type ResolveState = Pick<AppState, "datasets" | "resolveDataset" | "setStatus" | "status" | "reimportDataset">;

/** How `withResolved` settled. `error` is the message ALREADY shown to the user. */
export type ResolveOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

type OfferState = Pick<AppState, "datasets" | "reimportDataset">;

/** Can Relink revive this book? Only a PATH fetch of a dataset with a recorded
 *  source (`store/relinkCommit.ts` re-points exactly that); an upload token has no
 *  file to relink, so it is not offered there. */
export function canRelink(ds: Dataset): boolean {
  return ds.pending?.kind === "path" && ds.source != null;
}

/** The recovery a failed lazy-book load offers: Re-import. It re-reads the source
 *  and clears `pending`, or, for a source the desktop shell confirms missing or
 *  offline, says so and opens Relink (`store/reimport.ts`). An action toast
 *  defaults to the longer `TOAST_ACTION_TTL` (store/toasts.ts).
 *
 *  Dataset ids repeat across project loads, so the click re-checks that the id
 *  still names THIS book, still waiting on the same fetch; otherwise it does
 *  nothing rather than re-import whatever now holds the id. */
export function reimportOffer(get: () => OfferState, ds: Dataset): ToastOptions {
  const { id, pending } = ds;
  return {
    action: {
      label: "Re-import",
      onClick: () => {
        const now = get().datasets.find((d) => d.id === id);
        if (now?.pending && pending && sameBookSource(now.pending, pending)) void get().reimportDataset(id);
      },
    },
  };
}

/** Rejections already toasted. The fetch is single-flight (`installBookData`), so
 *  N actions queued on one dead book — plus a view's `ensureBookData` kick — all
 *  receive the SAME rejection object: one toast, while each action still writes
 *  its own status. A primitive rejection cannot be held here and just toasts. */
const announced = new WeakSet<object>();

/** Toast a lazy-book load failure once per failed fetch, offering Re-import. */
export function announceBookFailure(get: () => OfferState, ds: Dataset, msg: string, e: unknown): void {
  if (typeof e === "object" && e !== null) {
    if (announced.has(e)) return;
    announced.add(e);
  }
  toast(msg, "danger", reimportOffer(get, ds));
}

/** Resolve `id`'s full data, THEN run `fn` on the resolved dataset — the
 *  resolve-then-apply contract every mutating or outward action on a lazy Origin
 *  book goes through. A dataset that is not pending runs `fn` without a fetch.
 *
 *  `fn` runs in the same turn the resolve returns, on the dataset the store holds
 *  at that moment, so it can never act on the preview captured before the await.
 *  On failure `fn` never runs and nothing is written but the status (and one
 *  toast per failed fetch): the book stays `pending`, so the next action retries,
 *  and the message says what failed, that nothing changed, and how to recover. */
export async function withResolved<T>(
  get: () => ResolveState,
  id: string,
  action: string,
  fn: (resolved: Dataset) => T,
): Promise<ResolveOutcome<T>> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return { ok: false, error: "that dataset is no longer open" };
  if (ds.pending == null) return { ok: true, value: fn(ds) };
  let resolved: Dataset | undefined;
  try {
    resolved = await get().resolveDataset(id);
  } catch (e) {
    const error =
      `Could not finish ${action} in "${ds.name}": its full data failed to load ` +
      `(${truncateReason(e instanceof Error ? e.message : String(e))}). Nothing was changed. ` +
      (canRelink(ds) ? "Re-import it, or relink it if the file moved." : "Re-import the file to continue.");
    get().setStatus(error);
    announceBookFailure(get, ds, error, e);
    return { ok: false, error };
  }
  if (!resolved || resolved.pending) {
    // `installBookData` refused to install: the book this action was aimed at was
    // replaced (a project load reusing the id, a reimport, a relink) or closed
    // while it loaded. Its data is not this action's data.
    const error = `Could not finish ${action}: "${ds.name}" changed or closed while its full data loaded, so nothing was changed`;
    get().setStatus(error);
    return { ok: false, error };
  }
  return { ok: true, value: fn(resolved) };
}

/** `withResolved` for a synchronous store action. Returns false when `ds` is not
 *  pending — the caller applies inline, exactly as before. Otherwise schedules
 *  `apply` for once the full book is installed and returns true, so the caller
 *  must return without also applying it to the preview. `apply` receives the
 *  resolved dataset; returning `false` means a newer action superseded it.
 *
 *  The loading status distinguishes a first load from a RETRY of one that has
 *  already failed (`lastBookError`, BUG-009) — it never promises "in a moment". */
export function resolvePendingEdit(
  get: () => ResolveState,
  ds: Dataset,
  action: string,
  apply: (resolved: Dataset) => void | boolean,
): boolean {
  if (ds.pending == null) return false;
  const failed = lastBookError(ds.id, ds.pending);
  get().setStatus(
    failed == null
      ? `Loading full data for "${ds.name}" — ${action} will continue automatically`
      : `Retrying full data for "${ds.name}" (last attempt failed: ${truncateReason(failed)}) — ${action} will continue if it loads`,
  );
  void withResolved(get, ds.id, action, (resolved) => {
    const status = get().status;
    const applied = apply(resolved);
    // Keep a more specific message produced by the applied action (for example,
    // a paste warning or formula validation failure after full data arrived).
    if (get().status === status) {
      get().setStatus(applied === false
        ? `Full data loaded — skipped ${action} because a newer action replaced it`
        : `Full data loaded — finished ${action} in "${resolved.name}"`);
    }
  });
  return true;
}
