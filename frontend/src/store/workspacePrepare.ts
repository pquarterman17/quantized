// The shared preface of Save and Save As: resolve pending lazy books, then gather the live
// workspace state. Split out of store/workspaceIO.ts (500-line module ceiling) when the book fetch
// gained a StatusBar progress count and a Cancel (RESULT_ACCEPTANCE_AUDIT part 4, rows 8-9).
//
// Cancel while books load = stop waiting and write nothing: `prepareWorkspaceState` resolves null
// ("save cancelled"), so neither the codec, the dialog nor any write ever runs. The book fetches
// themselves are single-flight and shared with every view (`installBookData`), so Cancel never
// aborts one: a fetch already in flight may still land afterwards exactly as if the user had
// activated that book (provisional, owner to confirm). A late completion after Cancel is discarded
// by this save; it cannot resurrect it.

import { failedWith, truncateReason } from "../lib/bookData";
import { captureTechniqueView } from "../lib/techniqueViewMemory";
import { canRelink, reimportOffer } from "./pendingEdit";
import { beginOp, endOp, updateOp } from "./pendingOps";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

/** Wait for every pending book, with a "k/N" label and a Cancel on the StatusBar op.
 *  Resolves true when all books are in, false when the user cancelled; rejects like
 *  `resolvePendingDatasets` when a fetch fails. */
async function resolveBooksCancellable(get: SliceGet, total: number): Promise<boolean> {
  let cancelled = false;
  let cancel: () => void = () => {};
  const stop = new Promise<false>((resolve) => {
    cancel = () => {
      cancelled = true;
      resolve(false);
    };
  });
  const text = (done: number) => `Saving workspace: loading books ${done}/${total}`;
  const id = beginOp(text(0), () => cancel());
  try {
    const work = get()
      .resolvePendingDatasets((done) => updateOp(id, text(done)))
      .then(() => true as const);
    work.catch(() => {}); // a rejection after Cancel is no longer this save's to report
    const finished = await Promise.race([work, stop]);
    return finished && !cancelled;
  } finally {
    endOp(id);
  }
}

/** Resolve pending books and gather the live workspace state — the shared
 *  preface both Save (`runSaveWorkspace`) and Save As (`runSaveWorkspaceToFile`)
 *  need before they can write anything. Returns null when there is nothing to
 *  save or resolving pending books failed; both cases already set status/toast
 *  themselves, so callers just bail out.
 *
 *  Returns the (structurally WorkspaceState-compatible) store slice rather
 *  than an already-serialized string — P1.7 PR 3's Save As needs to pick its
 *  destination BEFORE it knows the `projectDir` `serializeWorkspace` should
 *  use for bundle-relative sources, so the actual `JSON.stringify` has to
 *  happen after that pick, not here. Everything ABOVE that split (bailing
 *  out on nothing-to-save, resolving pending books, folding in the focused
 *  window's live view) still runs at exactly the same point it always did. */
export async function prepareWorkspaceState(get: SliceGet): Promise<AppState | null> {
  const all = get().datasets;
  if (all.length === 0) {
    get().setStatus("no datasets to save");
    return null;
  }
  const pendingCount = all.filter((d) => d.pending).length;
  if (pendingCount > 0) {
    get().setStatus(`fetching ${pendingCount} book${pendingCount === 1 ? "" : "s"} before saving…`);
    try {
      if (!(await resolveBooksCancellable(get, pendingCount))) {
        get().setStatus("save cancelled — nothing was written");
        return null;
      }
    } catch (e) {
      // BUG-009: a book whose load failed for good (moved source, expired
      // upload token) refuses EVERY save — the file must be self-contained — so
      // an unnamed reason was a dead end. Name the book whose fetch failed with
      // THIS rejection (by identity, so an older failure of another book with
      // the same words is never blamed) and offer its recovery. Toasted
      // directly, not through the per-fetch dedupe: a view may already have
      // announced the load failure, but the user asked to SAVE and must hear
      // that the save did not happen.
      const reason = e instanceof Error ? e.message : String(e);
      const failed = get().datasets.find((d) => d.pending && failedWith(d.id, d.pending, e));
      const msg = failed
        ? `save failed — "${failed.name}" could not load its full data (${truncateReason(reason)}). Nothing was saved. ` +
          (canRelink(failed) ? "Re-import it (or relink it if the file moved)" : "Re-import the file") +
          ", or remove it, then save again."
        : `save failed — couldn't load full data for every book: ${reason}`;
      get().setStatus(msg);
      toast(msg, "danger", failed ? reimportOffer(get, failed) : undefined);
      return null;
    }
  }
  const s = get();
  // BUG-011 residual (2026-09-13): `resolvePendingDatasets()` only awaits the
  // books that were PENDING when it was called — a lazy import landing while
  // that `Promise.all` is still in flight is never in that snapshot, so the
  // re-read above can still carry a dataset whose `pending` came back true
  // AFTER the resolve step finished with it. Refuse rather than serialize its
  // downsampled preview rows, mirroring `store/packProjectContent.ts`'s own
  // post-await re-check (BUG-011 finding #2) — same status + toast shape as
  // the catch block just above (which reports the thrown reason and names no
  // book); the by-name refusal itself mirrors `packProjectContent.ts`.
  const stillPending = s.datasets.find((d) => d.pending);
  if (stillPending) {
    const msg = `save failed — couldn't load full data for every book: "${stillPending.name}" was still loading`;
    get().setStatus(msg);
    toast(msg, "danger");
    return null;
  }
  // PLOT_WORKFLOW_PLAN item 5: fold the FOCUSED window's still-live view into
  // its technique's memory slot before saving — mirrors `windowsForSave()`'s
  // "save is a sanctioned snapshot point" so unswitched-away edits aren't lost.
  const techniqueViewMemory = captureTechniqueView(
    s.datasets.find((d) => d.id === s.activeId),
    s,
    s.techniqueViewMemory,
  );
  return { ...s, plotWindows: s.windowsForSave(), techniqueViewMemory };
}
