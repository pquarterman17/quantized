// The three crash-recovery choices (P1.2 box "explain crash recovery
// source/time/choices"): the RecoveryChoiceDialog component calls exactly
// one of these; nothing else does, which is what keeps the dialog itself a
// thin renderer.

import { openRecentProject } from "../commands/recentProjectsCommands";
import { useRecoveryChoice, type RecoveryPrompt } from "../store/recoveryChoice";
import { useApp } from "../store/useApp";
import { toast } from "../store/toasts";
import { stageWorkspaceRestore } from "../store/windowHydration";

/** "Recover autosaved work" — load the autosave candidate into the live
 *  session and adopt the LAST PROJECT's identity for it (so an immediate
 *  Ctrl+S writes back to the right file), but leave it explicitly DIRTY:
 *  the recovered content has not actually been written to that path, and
 *  claiming otherwise would be the exact "silently restore over a named
 *  project" the box forbids — this is the opposite, a LOUD recovery the
 *  user must still choose to save. `markProjectDirty()` runs explicitly
 *  AFTER `setCurrentProject`/`loadWorkspace` rather than relying on
 *  useWorkspaceAutosave.ts's ambient autosave-relevant subscriber to flip
 *  it as a side effect — this action must be correct on its own regardless
 *  of what else happens to be mounted (see store/project.ts's header for
 *  the general "identity-setters resolve dirty state atomically" rule this
 *  still honors: the two calls below are the explicit, self-contained
 *  version of it). */
export function applyRecoverAutosave(prompt: RecoveryPrompt): void {
  const s = useApp.getState;
  s().setCurrentProject({ name: prompt.lastProject.name, path: prompt.lastProject.path });
  s().loadWorkspace(prompt.workspace);
  s().markProjectDirty();
  stageWorkspaceRestore(s().plotWindows, s().focusedWindowId);
  const n = prompt.datasetCount;
  const msg = `recovered ${n} dataset${n === 1 ? "" : "s"} from autosave — newer than "${prompt.lastProject.name}"`;
  s().setStatus(msg);
  toast(`${msg}. Save to keep it.`, "info");
  useRecoveryChoice.getState().clearRecovery();
}

/** "Keep <last project>" — discard the autosave candidate entirely and
 *  reopen the last project from DISK instead, through the exact same path
 *  a Recent Projects click uses (missing/offline handling included). The
 *  autosave generation itself is left untouched in storage — nothing here
 *  deletes it — so a user who picks this and changes their mind can still
 *  find the same recovery candidate offered again next startup, as long as
 *  it is still newer than whatever they save next. */
export async function applyKeepLastProject(prompt: RecoveryPrompt): Promise<void> {
  useRecoveryChoice.getState().clearRecovery();
  await openRecentProject(prompt.lastProject.name, prompt.lastProject.path);
}

/** "Cancel" — closes the prompt and does nothing else. Both candidates
 *  survive untouched: the autosave generation stays in storage, the last
 *  project's file stays on disk, and the live session is whatever it was
 *  before the prompt appeared (nothing was auto-loaded) — "keeps both". */
export function applyCancelRecovery(): void {
  useRecoveryChoice.getState().clearRecovery();
}
