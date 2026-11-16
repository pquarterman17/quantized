// The startup autosave restore — moved out of useWorkspaceAutosave.ts (size
// ceiling) with the soak-fix review's restore rules (reviews 2 and 3):
//
//  - A restore whose code will not load is RETRIED (2 s, doubling to 30 s).
//    Until a restore has succeeded or been declined, the generations from
//    before this session stay pinned (lib/autosave.ts) and the state rides on
//    the health line's own `restoreError` field.
//  - Nothing is ever applied automatically over the user's work: a restore
//    that lands late (after a failed first attempt), or after the workspace
//    was replaced or a project opened since startup, goes through the
//    non-blocking "Append / Replace / Discard" prompt (lib/lateRestore.ts, a
//    lazy chunk) instead.
//  - Only an applied restore, a successful Replace, Recover in the startup
//    recovery dialog, or Discard settles the pin. Cancel and "Keep last
//    project" keep it (their own docs promise the autosave stays available).

import { autosaveHealth, autosaveRestorePending, autosaveRestoreSettled, loadAutosaveGeneration } from "./lib/autosave";
import { shouldOfferRecoveryChoice, type LastProjectRef } from "./lib/recoveryChoice";
import { installSessionMarker, priorSessionEnd } from "./lib/sessionMarker";
import { reportAutosaveHealth } from "./store/autosaveStatus";
import { useRecentProjects } from "./store/recentProjects";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { notifyMigrationWarnings, toast } from "./store/toasts";
import { useApp } from "./store/useApp";
import { stageWorkspaceRestore } from "./store/windowHydration";
import { onWorkspaceReplace } from "./store/workspaceReplace";

type Picked = Awaited<ReturnType<typeof loadAutosaveGeneration>>;

const report = () => reportAutosaveHealth(autosaveHealth());
const why = (e: unknown) => (e instanceof Error ? e.message : "load failed");

function lastKnownProject(): LastProjectRef | null {
  const entry = useRecentProjects.getState().recentProjects[0];
  return entry ? { name: entry.name, path: entry.path, at: Date.parse(entry.at) } : null;
}

/** Hand a late or contended restore to the lazy prompt. */
function offerLater(picked: NonNullable<Picked>): void {
  void import("./lib/lateRestore").then(
    (m) => m.offerLateRestore(picked),
    (e: unknown) => {
      autosaveRestorePending(`Couldn't show the recovery prompt (${why(e)}) — reload to try again; the previous session is kept`);
      report();
    },
  );
}

/** Apply what the startup restore found. `contended`: it landed late, or the
 *  user has since replaced the workspace or opened a project. */
function restorePicked(picked: Picked, contended: boolean, priorEnd: ReturnType<typeof priorSessionEnd>, setStatus: (msg: string) => void): void {
  if (!picked?.workspace.datasets.length) return (autosaveRestoreSettled(), report());
  if (contended) return offerLater(picked);
  const { workspace: restored, at: autosaveAt } = picked;
  const n = restored.datasets.length;
  const what = `${n} dataset${n === 1 ? "" : "s"}`;
  // P1.2 box 5: only when there IS a named last project AND the candidate is
  // actually newer does silent auto-restore stop being safe — see
  // lib/recoveryChoice.ts's header. Its Recover choice settles the pin
  // (lib/applyRecoveryChoice.ts); Cancel and Keep leave it.
  const lastProject = lastKnownProject();
  if (shouldOfferRecoveryChoice(autosaveAt, lastProject)) {
    useRecoveryChoice.getState().offerRecovery({ workspace: restored, autosaveAt, datasetCount: n, lastProject: lastProject as LastProjectRef });
    return;
  }
  useApp.getState().loadWorkspace(restored);
  stageWorkspaceRestore(useApp.getState().plotWindows, useApp.getState().focusedWindowId);
  autosaveRestoreSettled();
  report();
  if (priorEnd === "unclean") {
    setStatus(`recovered ${what} after an unexpected close`);
    toast(`Recovered ${what} after an unexpected close — check your latest edits`, "info");
  } else {
    // BUG-010: this setStatus overwrites loadWorkspace's own migrationNotice
    // status-line fold — the toast below is the only channel that survives it.
    setStatus(`restored ${what} from autosave`);
  }
  notifyMigrationWarnings(restored.migrationWarnings);
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
    void loadAutosaveGeneration().then(
      (picked) => {
        if (cancelled) return;
        offReplace(); // anything after this is the restore's own doing
        restorePicked(picked, late || replaced || useApp.getState().currentProject !== null, priorEnd, setStatus);
      },
      (e: unknown) => {
        if (cancelled) return;
        const msg = `Couldn't restore the autosaved library (${why(e)}) — retrying; earlier autosaves are kept`;
        if (!late) toast(msg, "danger");
        autosaveRestorePending(msg);
        report();
        retry = setTimeout(() => attempt(true), delay);
        delay = Math.min(delay * 2, 30_000);
      },
    );
  };
  attempt(false);
  return () => {
    cancelled = true;
    clearTimeout(retry);
    offReplace();
    teardown();
  };
}
