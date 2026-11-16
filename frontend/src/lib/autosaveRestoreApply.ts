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
import { notifyMigrationWarnings, toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { stageWorkspaceRestore } from "../store/windowHydration";
import { autosaveHealth, autosaveRestorePending, autosaveRestoreSettled, type loadAutosaveGeneration } from "./autosave";
import { shouldOfferRecoveryChoice, type LastProjectRef } from "./recoveryChoice";

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

/** Apply what the startup restore found. `contended`: it landed late, or the
 *  user has since replaced the workspace, opened a project or imported data
 *  — then it is only offered. A recovery carried over from the previous page
 *  is offered too, beside this page's newest save (review F2). */
export function applyRestored(picked: Picked, contended: boolean, unclean: boolean, setStatus: (msg: string) => void): void {
  const carried = picked?.carried;
  const onlyCarried = carried !== undefined && carried.at === picked?.at;
  restorePicked(picked, contended || onlyCarried, unclean, setStatus);
  if (carried && !onlyCarried) {
    autosaveRestorePending("The previous session's autosave is waiting: choose Append, Replace or Discard", carried.at + 1);
    report();
    offerLater(carried);
  }
}

function restorePicked(picked: Picked, contended: boolean, unclean: boolean, setStatus: (msg: string) => void): void {
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
  if (unclean) {
    setStatus(`recovered ${what} after an unexpected close`);
    toast(`Recovered ${what} after an unexpected close — check your latest edits`, "info");
  } else {
    // BUG-010: this setStatus overwrites loadWorkspace's own migrationNotice
    // status-line fold — the toast below is the only channel that survives it.
    setStatus(`restored ${what} from autosave`);
  }
  notifyMigrationWarnings(restored.migrationWarnings);
}
