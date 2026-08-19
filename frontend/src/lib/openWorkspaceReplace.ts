// Shared "replace the whole workspace" helpers for the two open commands
// (commands/fileCommands.ts's "open-workspace" / "open-workspace-safe") —
// split out under that module's own size ratchet (RSM_CUTS_PLAN #20's
// general 500-line ceiling), the same way lib/exportFigureCommand.ts
// already carries a command's body out of the curated command list.

import { stageWorkspaceRestore } from "../store/windowHydration";
import { useProjectLock } from "../store/projectLock";
import type { ProjectIdentity } from "../store/project";
import { toast } from "../store/toasts";
import type { StoreGet } from "./exportActive";
import type { LoadedWorkspace } from "./workspace";

/** PR I2 (L0.47): a genuine native open (a real `native.path`) registers
 *  with the lock state machine — fire-and-forget, AFTER the replace already
 *  committed (this function's own callers already gate the replace itself
 *  behind a confirm dialog; re-litigating "should this open happen" against
 *  an async lock check would mean either blocking the whole open on it, or
 *  building a second confirm surface — both deferred, see
 *  store/projectLock.ts's header for the full booked scope). What DOES
 *  happen synchronously with today's slice: read-only status lands in
 *  `useProjectLock`, gating the next quick-save (store/workspaceIO.ts's
 *  `runSaveWorkspace`) the moment the check resolves, and a toast explains
 *  the situation with the two named next steps (Take Over Editing / Open
 *  as Copy — commands/projectLockCommands.ts). `openProject` itself never
 *  throws (see that module's own doc), so no `.catch` is needed here. */
function registerWithLockStateMachine(native: ProjectIdentity | undefined): void {
  if (!native) return;
  void (async () => {
    // A previously-open project this SAME instance held must be released
    // before acquiring the new one — otherwise switching projects (Open
    // replacing an already-open one) would strand the old lock forever,
    // the exact "silent" failure mode L0.47 exists to prevent, just aimed
    // at the instance's OWN prior session instead of another instance's.
    const prev = useProjectLock.getState();
    if (prev.path && prev.path !== native.path && prev.status === "held-by-me") {
      await prev.releaseLock();
    }
    const result = await useProjectLock.getState().openProject(native.path);
    if (!result.readOnly) return;
    const reason =
      result.status === "held-by-other-stale"
        ? "another (unresponsive) instance has this project open — Take Over Editing is available"
        : "another instance has this project open for editing — opened read-only";
    toast(`"${native.name}": ${reason}`, "info");
  })();
}

/** `loadWorkspace` + the P3.4 slice 4 staging call that must immediately
 *  follow it (see `stageWorkspaceRestore`'s doc) — shared by open-workspace's
 *  two branches (empty library, and the confirmed-replace path) so the
 *  three-statement sequence isn't duplicated.
 *
 *  P1.2 box 1: `native` is the project identity to adopt — a real native
 *  open/reopen passes its `{name, path}`; a browser-picker open (no durable
 *  path) passes nothing, which CLEARS `currentProject` rather than leaving
 *  it pointing at whatever was open before. Either way the identity is set
 *  in the SAME call as the actual replace, never before it (a confirm
 *  dialog can still say no) — see store/project.ts's header on why that
 *  ordering matters. */
export function replaceWorkspace(s: StoreGet, ws: LoadedWorkspace, native?: ProjectIdentity): void {
  s().recordHistory("open workspace");
  s().loadWorkspace(ws);
  s().setCurrentProject(native ?? null);
  stageWorkspaceRestore(s().plotWindows, s().focusedWindowId);
  registerWithLockStateMachine(native);
}

/** "Open Without Layout…" (PR E2's safe-open) — same replace as
 *  `replaceWorkspace` above, but `loadWorkspace`'s `skipLayout` option drops
 *  the incoming plotWindows/focusedWindowId/toolWindowLayout and lands on
 *  the single fresh window every layout-less doc already gets; everything
 *  else restores normally. */
export function replaceWorkspaceSafely(s: StoreGet, ws: LoadedWorkspace, native?: ProjectIdentity): void {
  s().recordHistory("open workspace without layout");
  s().loadWorkspace(ws, { skipLayout: true });
  s().setCurrentProject(native ?? null);
  stageWorkspaceRestore(s().plotWindows, s().focusedWindowId);
  registerWithLockStateMachine(native);
}

/** Whether the CURRENT session holds anything a workspace replace would
 *  discard. Sol's PR #152 review (P1): gating the confirm on
 *  `datasets.length` alone let a dataset-free session with real content —
 *  folders, workbooks, frozen editable/publication figures, pages,
 *  reports, smart folders, saved graphs, macro steps, saved ROIs — get
 *  silently replaced. Enumerated from EVERY persisted, user-owned
 *  collection `loadWorkspace` (store/useApp.ts) resets unconditionally on
 *  load (verified against its return object, not assumed). */
export function hasWorkspaceContent(s: StoreGet): boolean {
  const st = s();
  return (
    st.datasets.length > 0 ||
    st.folders.length > 0 ||
    st.workbooks.length > 0 ||
    st.originFigures.length > 0 ||
    st.editableFigures.length > 0 ||
    st.figureDocs.length > 0 ||
    st.pages.length > 0 ||
    st.reports.length > 0 ||
    st.smartFolders.length > 0 ||
    st.savedPlotSpecs.length > 0 ||
    st.macroSteps.length > 0 ||
    st.savedRois.length > 0 ||
    // Sol follow-up (PR #152): techniqueViewMemory is serialized in the
    // .dwk, restored per project, and overwritten on load — customized
    // plotting behavior is user-owned project content, not disposable
    // preference state.
    Object.keys(st.techniqueViewMemory).length > 0
  );
}

/** Shared "you're about to replace N datasets" confirm body for both open
 *  commands; `extra` appends the safe-open's layout-skip notice. Stays
 *  dataset-oriented when there ARE datasets (the common case); a
 *  dataset-free-but-not-empty session (`hasWorkspaceContent` above is the
 *  only way `n === 0` still gets here) degrades to naming the OTHER
 *  content instead of claiming "0 datasets". */
export function replaceConfirmMessage(n: number, extra = ""): string {
  const subject =
    n > 0
      ? `the ${n} dataset${n === 1 ? "" : "s"} currently loaded, plus every folder, report and saved figure`
      : `the current session's folders, workbooks, and saved figures, reports, and pages`;
  return `Opening this file discards ${subject}.${extra} Save your work first if you need it.`;
}
