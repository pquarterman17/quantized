// Single-flight lazy-book resolution (ORIGIN_FILE_DECODE_PLAN #38) —
// extracted from store/useApp.ts under its size ratchet (the #152/#153
// merge landed the store 2 lines over the 2818 pin; this module is the
// "extract a slice, never raise the pin" answer). Pure lib: the store
// setter comes in as a parameter, so there's no store import and no cycle.

import { fetchBookData } from "./api";
import type { BookSource, Dataset } from "./types";

/** The narrow slice of the store's `set` this module needs — an updater
 *  over `datasets` only, structurally compatible with Zustand's `set`. */
type DatasetsSetter = (fn: (s: { datasets: Dataset[] }) => { datasets: Dataset[] }) => void;

/** In-flight lazy-book fetches, single-flight and keyed by dataset id — a
 *  book bound into two places at once (e.g. two plot windows) triggers
 *  exactly one HTTP fetch. Module scope, not store state: a Promise has no
 *  business flowing through Zustand subscribers or (accidentally) a .dwk
 *  serialize. */
const _bookFetches = new Map<string, Promise<void>>();

/** BUG-009: why the LAST fetch for a dataset failed, or no entry if none has.
 *  `store/pendingEdit.ts` reads it so a guarded action can say what actually
 *  happened instead of promising a retry "in a moment" that cannot succeed.
 *
 *  MODULE SCOPE, NOT A `Dataset` FIELD — and the first version of this fix put
 *  it on `Dataset`, which is how the reason is known rather than guessed. A
 *  failed fetch previously performed NO store write at all, and writing one
 *  gave `datasets` a new array (and the dataset a new object) identity on every
 *  failure. Two live consequences, both measured in review:
 *    * `components/windows/WindowCanvas.tsx` and
 *      `components/Stage/useMultiPanelStage.ts` have effects whose deps include
 *      `datasets` / the active `Dataset` and whose bodies call `ensureBookData`
 *      when `pending` is set. A new identity re-ran the effect, which re-fetched,
 *      which failed, which wrote again: an unbounded request storm on exactly
 *      the dead book this fix is about.
 *    * `useWorkspaceAutosave.ts`'s `shouldAutosave` compares `state.datasets`
 *      by IDENTITY, so the write marked a clean project dirty and, once looping,
 *      reset the 800 ms autosave debounce faster than it could ever fire —
 *      starving autosave of real user edits.
 *  A fetch outcome is transport state, like the in-flight promise above it. It
 *  has no business flowing through Zustand subscribers, a `.dwk` serialize, an
 *  undo snapshot, or a channel remap — and keeping it here is what makes all
 *  four true by construction rather than by four separate allowlists.
 *
 *  Keyed by dataset id, like `_bookFetches`, but the entry also records WHICH
 *  source failed: ids can repeat across a project load, and a reason recorded
 *  for a different book must not be reported for this one. */
const _bookErrors = new Map<string, { source: BookSource; message: string }>();

/** Why the last fetch for `id` failed, or null while none has failed (or the
 *  recorded failure belongs to a different book). `source` is the book being
 *  asked about, so a stale entry from a previous project cannot answer.
 *
 *  ALL FOUR identity fields are compared, `token` included, and that is not
 *  belt-and-braces: an upload `BookSource` has no `path`, so without `token` the
 *  check degenerates to `bookId` alone for exactly the case BUG-009 names — an
 *  EXPIRED UPLOAD TOKEN. Compared directly rather than through a built key
 *  string (same answer, less code in the eager bundle). */
export function lastBookError(id: string, source: BookSource): string | null {
  const rec = _bookErrors.get(id);
  if (!rec) return null;
  const s = rec.source;
  return s.kind === source.kind &&
    s.path === source.path &&
    s.token === source.token &&
    s.bookId === source.bookId
    ? rec.message
    : null;
}

/** A backend `detail` can be arbitrarily long — and for a FastAPI 422 it is an
 *  ARRAY, which `lib/api/http.ts` stringifies rather than rejecting. Neither
 *  belongs verbatim in a one-line status or a refusal reason, so cap it and say
 *  it was cut. Lives here, beside the record, because BOTH consumers of a
 *  recorded reason need it — `store/pendingEdit.ts` and
 *  `lib/workbookTransfer.ts` — and the second one was interpolating it raw. */
export function truncateReason(reason: string): string {
  const flat = reason.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}\u2026` : flat;
}

/** Test-only: drop all transport state so one test's in-flight promise or
 *  recorded failure cannot answer for the next.
 *
 *  CALL THIS in the `beforeEach` of any suite that exercises a pending-dataset
 *  guard. `refusePendingEdit` kicks a REAL fetch, which rejects under jsdom, so
 *  a guard test records a failure that a later test in the same file would
 *  otherwise report — two suites asserting "still loading its full data" got
 *  "the last attempt … failed" instead. Deliberately NOT wired into
 *  `src/test/setup.ts`: importing this module there resolves `./api` before any
 *  suite's `vi.mock("../lib/api")` applies, which silently un-mocks the fetch
 *  for every test in the repo (measured). */
export function resetBookTransportForTests(): void {
  _bookFetches.clear();
  _bookErrors.clear();
}

/** Fetch one dataset's full data and install it, single-flight. Resolves
 *  (not rejects) once the swap lands — `ensureBookData` (fire-and-forget UI
 *  trigger) attaches its own `.catch` for the toast; `resolvePendingDatasets`
 *  (the .dwk pre-save resolver) awaits the SAME promise and lets a failure
 *  propagate so the caller can abort the save. */
export function installBookData(set: DatasetsSetter, id: string, source: BookSource): Promise<void> {
  const inFlight = _bookFetches.get(id);
  if (inFlight) return inFlight;
  const p = fetchBookData(source)
    .then((full) => {
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id
            ? {
                ...d,
                data: full,
                pending: undefined,
                // Row-state indices were against the PREVIEW rows (#50/#53)
                // — they no longer mean anything against the real data.
                excludedRows: undefined,
                filter: undefined,
              }
            : d,
        ),
      }));
      // The book arrived: whatever the last attempt failed with is history.
      _bookErrors.delete(id);
    })
    .then(undefined, (e: unknown) => {
      // BUG-009: record WHY, so `store/pendingEdit.ts` can stop promising a
      // retry "in a moment" for a book that will never arrive. `pending` stays
      // set on purpose (a retry may still work); only the message changes.
      // Re-thrown unchanged, so every existing caller's error handling —
      // `resolveDataset`'s reject, the save command's abort — is untouched.
      //
      // A REJECTION HANDLER, not `.catch`: `.catch` here would also catch a throw
      // from the SUCCESS handler above (a Zustand subscriber throwing during the
      // datasets swap), recording a fetch that actually succeeded as a failure and
      // skipping the delete. Unreadable today — `pending` is already cleared by
      // then, so the message short-circuits — but the record would mean less than
      // this comment claims.
      _bookErrors.set(id, { source, message: e instanceof Error ? e.message : String(e) });
      throw e;
    })
    .finally(() => {
      _bookFetches.delete(id);
    });
  _bookFetches.set(id, p);
  return p;
}
