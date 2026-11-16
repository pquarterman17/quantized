// The startup autosave restore — moved out of useWorkspaceAutosave.ts (size
// ceiling) with the soak-fix review's restore rules (reviews 2 to 4):
//
//  - A restore whose code will not load is RETRIED (2 s, doubling to 30 s;
//    the status-bar label retries at once). Until a restore has succeeded or
//    been declined, the generations from before this session stay pinned
//    (lib/autosave.ts) and the state rides on the health line's own
//    `restoreError` field.
//  - The restore is not applied automatically when it lands late (after a
//    failed first attempt), or once the workspace was replaced, a project
//    opened or datasets imported since startup: those go through the
//    non-blocking "Append / Replace / Discard" prompt (lib/lateRestore.ts, a
//    lazy chunk) instead. (Other early edits made before the restore lands —
//    a folder, a title — are still replaced by it, as on main.)
//  - A recovery the previous page left unanswered (the pending-recovery
//    marker) is OFFERED again at startup: its generation is never restored
//    silently, and this page's newest save is restored beside the offer.
//  - Only an applied restore, a successful Replace, Recover in the startup
//    recovery dialog, or Discard settles the pin. Cancel and "Keep last
//    project" keep it (their own docs promise the autosave stays available).

import { autosaveHealth, autosaveRestorePending, loadAutosaveGeneration } from "./lib/autosave";
import { installSessionMarker, priorSessionEnd } from "./lib/sessionMarker";
import { reportAutosaveHealth } from "./store/autosaveStatus";
import { toast } from "./store/toasts";
import { useApp } from "./store/useApp";
import { onWorkspaceReplace } from "./store/workspaceReplace";

const report = () => reportAutosaveHealth(autosaveHealth());
const why = (e: unknown) => (e instanceof Error ? e.message : "load failed");

/** A failed restore's "try again now" (review F10), while one is pending. */
let retryNow: (() => void) | null = null;

/** The status-bar label's click while the restore is still failing: retry
 *  at once instead of waiting for the backoff. False when none is pending. */
export function retryAutosaveRestoreNow(): boolean {
  if (!retryNow) return false;
  retryNow();
  return true;
}

/** Run the startup restore; returns its teardown (the effect's cleanup). */
export function startAutosaveRestore(setStatus: (msg: string) => void): () => void {
  // `cancelled` guards the StrictMode double-invoke and an unmount mid-read —
  // restoring into a torn-down store would clobber whatever the user did.
  let cancelled = false;
  // Read how the PREVIOUS session ended before marking this one active —
  // installSessionMarker overwrites the flag.
  const priorEnd = priorSessionEnd();
  const teardown = installSessionMarker();
  let replaced = false;
  const offReplace = onWorkspaceReplace(() => {
    replaced = true;
  });
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 2000;
  const attempt = (late: boolean): void => {
    retryNow = null;
    // What to DO with it lives in a lazy chunk, fetched alongside the read;
    // either failing to load is the same "retry" case (lib/autosaveRestoreApply.ts).
    void Promise.all([loadAutosaveGeneration(), import("./lib/autosaveRestoreApply")]).then(
      ([picked, { applyRestored }]) => {
        if (cancelled) return;
        offReplace(); // anything after this is the restore's own doing
        const st = useApp.getState();
        applyRestored(picked, late || replaced || st.currentProject !== null || st.datasets.length > 0, priorEnd === "unclean", setStatus);
      },
      (e: unknown) => {
        if (cancelled) return;
        const msg = `Couldn't restore the autosaved library (${why(e)}) — retrying; earlier autosaves are kept (click to retry now)`;
        if (!late) toast(msg, "danger");
        autosaveRestorePending(msg);
        report();
        retry = setTimeout(() => attempt(true), delay);
        delay = Math.min(delay * 2, 30_000);
        retryNow = () => {
          clearTimeout(retry);
          attempt(true);
        };
      },
    );
  };
  attempt(false);
  return () => {
    cancelled = true;
    retryNow = null;
    clearTimeout(retry);
    offReplace();
    teardown();
  };
}
