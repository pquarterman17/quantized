// What the startup autosave restore does with what it found — a lazy chunk
// (bundle headroom), fetched alongside the restore's own read by
// ../autosaveStartupRestore.ts, which keeps only the attempt/retry loop
// eager. If this chunk will not load, that loop treats it like any restore
// whose code will not load: it retries, and the pin holds meanwhile.
//
// The rules (soak-fix reviews 2 to 4) are documented in that module's header.

import { reportAutosaveHealth } from "../store/autosaveStatus";
import { useRecentProjects } from "../store/recentProjects";
import { useRecoveryChoice } from "../store/recoveryChoice";
import { notifyMigrationWarnings } from "../store/toasts";
import { useApp } from "../store/useApp";
import { stageWorkspaceRestore } from "../store/windowHydration";
import { autosaveHealth, autosaveRestorePending, autosaveRestoreSettled, type loadAutosaveGeneration } from "./autosave";
import { shouldOfferRecoveryChoice, type LastProjectRef } from "./recoveryChoice";
import { decideStartup } from "./startupDecision";
import { workflowPrefsSlot } from "./workflowPrefs";

type Picked = Awaited<ReturnType<typeof loadAutosaveGeneration>>;

const report = () => reportAutosaveHealth(autosaveHealth());
const why = (e: unknown) => (e instanceof Error ? e.message : "load failed");

function lastKnownProject(): LastProjectRef | null {
  const entry = useRecentProjects.getState().recentProjects[0];
  return entry ? { name: entry.name, path: entry.path, at: Date.parse(entry.at) } : null;
}

/** Hand a late, contended or carried-over restore to the lazy prompt. */
function offerLater(picked: NonNullable<Picked>): void {
  void import("./lateRestore").then(
    (m) => m.offerLateRestore(picked),
    (e: unknown) => {
      autosaveRestorePending(`Couldn't show the recovery prompt (${why(e)}) — reload to try again; the previous session is kept`);
      report();
    },
  );
}

/** Hold a session for the welcome screen's "Restore last session" card. */
function holdForWelcomeLazy(picked: NonNullable<Picked>, crashed: boolean): void {
  void import("./lateRestore").then(
    (m) => m.holdForWelcome(picked, crashed),
    (e: unknown) => {
      autosaveRestorePending(`Couldn't hold the previous session (${why(e)}) — reload to try again; it is kept`);
      report();
    },
  );
}

/** Apply what the startup restore found. `contended`: it landed late, or the
 *  user has since replaced the workspace, opened a project or imported data
 *  — then it is only offered. A recovery carried over from the previous page
 *  is offered too, beside this page's newest save (review F2). */
export function applyRestored(picked: Picked, contended: boolean, unclean: boolean, setStatus: (msg: string) => void): void {
  const carried = picked?.carried;
  const onlyCarried = carried !== undefined && carried.at === picked?.at;
  // A carried-over recovery is never applied silently (it asks); on the welcome
  // screen it is held like any other autosave, so only "reopen" treats it as contended.
  const reopen = workflowPrefsSlot.load().onStartup === "reopen";
  const held = restorePicked(picked, contended || (onlyCarried && reopen), unclean, setStatus);
  // A session held for the welcome screen is the newest; the older carried one
  // stays pinned in storage behind it, offered again once this one is answered.
  if (carried && !onlyCarried && !held) {
    autosaveRestorePending("The previous session's autosave is waiting: choose Append, Replace or Discard", carried.at + 1);
    report();
    offerLater(carried);
  }
}

/** Returns true when the session was HELD for the welcome screen. */
function restorePicked(picked: Picked, contended: boolean, unclean: boolean, setStatus: (msg: string) => void): boolean {
  const lastProject = lastKnownProject();
  const action = decideStartup({
    mode: workflowPrefsSlot.load().onStartup,
    hasAutosave: !!picked?.workspace.datasets.length,
    crashed: unclean,
    contended,
    newerThanLastProject: picked ? shouldOfferRecoveryChoice(picked.at, lastProject) : false,
  });
  if (action === "nothing" || !picked) return (autosaveRestoreSettled(), report(), false);
  if (action === "late-prompt") return (offerLater(picked), false);
  if (action === "welcome-offer") return (holdForWelcomeLazy(picked, unclean), true);
  const { workspace: restored, at: autosaveAt } = picked;
  const n = restored.datasets.length;
  const what = `${n} dataset${n === 1 ? "" : "s"}`;
  // P1.2 box 5: only when there IS a named last project AND the candidate is
  // actually newer does silent auto-restore stop being safe — see
  // lib/recoveryChoice.ts's header. Its Recover choice settles the pin
  // (lib/applyRecoveryChoice.ts); Cancel and Keep leave it.
  if (action === "recovery-dialog") {
    useRecoveryChoice.getState().offerRecovery({ workspace: restored, autosaveAt, datasetCount: n, lastProject: lastProject as LastProjectRef });
    return false;
  }
  useApp.getState().loadWorkspace(restored);
  stageWorkspaceRestore(useApp.getState().plotWindows, useApp.getState().focusedWindowId);
  autosaveRestoreSettled();
  report();
  // A crash never gets here (decideStartup always offers it on the welcome
  // screen), so this is the ordinary "Reopen last session" restore.
  // BUG-010: this setStatus overwrites loadWorkspace's own migrationNotice
  // status-line fold: the toast below is the only channel that survives it.
  setStatus(`restored ${what} from autosave`);
  notifyMigrationWarnings(restored.migrationWarnings);
  return false;
}
