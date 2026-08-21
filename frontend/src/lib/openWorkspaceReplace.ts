// Shared "replace the whole workspace" helpers for the two open commands
// (commands/fileCommands.ts's "open-workspace" / "open-workspace-safe") —
// split out under that module's own size ratchet (RSM_CUTS_PLAN #20's
// general 500-line ceiling), the same way lib/exportFigureCommand.ts
// already carries a command's body out of the curated command list.

import { canRelease, type LockRecord } from "../lib/lockState";
import { stageWorkspaceRestore } from "../store/windowHydration";
import { useProjectLock, type LockProvider } from "../store/projectLock";
import type { ProjectIdentity } from "../store/project";
import { useRecentProjects } from "../store/recentProjects";
import { toast } from "../store/toasts";
import type { StoreGet } from "./exportActive";
import type { LoadedWorkspace } from "./workspace";

/** Snapshot of the lock this instance held BEFORE a project switch —
 *  captured by `reserveLockForSwitch` synchronously, before that function
 *  overwrites `useProjectLock`'s live `path`/`record`, so the async release
 *  step in `registerWithLockStateMachine` still knows what (if anything) to
 *  release even though the live store no longer reflects it. */
interface PriorLock {
  path: string | null;
  record: LockRecord | null;
  instanceId: string;
  provider: LockProvider;
}

/** P3 (adversarial review, 2026-08-19) — the SYNCHRONOUS half of PR I2's
 *  registration, called BEFORE `setCurrentProject` (never after): reserves
 *  `useProjectLock.path` at the NEW project's path immediately, with a
 *  conservative read-only PLACEHOLDER status, so there is NO window where
 *  `useApp.currentProject.path` already names the new project while
 *  `useProjectLock.path` still names the old one (or nothing). That window
 *  used to exist because the old code pointed the lock machine at the new
 *  path only inside an async IIFE, entirely AFTER `setCurrentProject` had
 *  already run — any save gate comparing `lock.path === project.path`
 *  during that gap saw a manufactured mismatch and skipped its own check
 *  entirely, writing completely ungated. The placeholder status
 *  (`"held-by-other-live"`, reused rather than adding a fifth `LockStatus`
 *  just for this — it already means exactly "read-only, not yet writable"
 *  everywhere `canWriteNow`/`isReadOnly` read it) is overwritten with the
 *  REAL status the moment `openProject`'s async read resolves, in
 *  `registerWithLockStateMachine` below; the only user-visible cost is a
 *  possible spurious one-tick "read-only" refusal from a save that lands in
 *  the now-milliseconds-wide gap, never a silent ungated write.
 *
 *  Returns the PRIOR lock (captured before being overwritten) for the async
 *  continuation to release, or `null` when there is nothing to reserve
 *  (`native` absent) or nothing to change (already tracking this exact
 *  path — a same-path reopen needs neither a placeholder nor a release). */
function reserveLockForSwitch(native: ProjectIdentity | undefined): PriorLock | null {
  if (!native) return null;
  const prev = useProjectLock.getState();
  const prior: PriorLock = { path: prev.path, record: prev.record, instanceId: prev.instanceId, provider: prev.provider };
  if (prev.path === native.path) return prior; // same project — nothing to reserve or release
  useProjectLock.setState({ path: native.path, status: "held-by-other-live", record: null, openedAsCopy: false });
  return prior;
}

/** PR I2 (L0.47): the ASYNC half — releases the prior project's lock (if
 *  this instance genuinely held one, and it differs from the new path —
 *  see `reserveLockForSwitch`'s doc for why switching projects must never
 *  strand the old lock), then resolves the placeholder `reserveLockForSwitch`
 *  set into the REAL status via `openProject`. Fire-and-forget relative to
 *  the synchronous replace (this function's own callers already gate the
 *  replace itself behind a confirm dialog; re-litigating "should this open
 *  happen" against an async lock check would mean either blocking the whole
 *  open on it, or building a second confirm surface — both deferred, see
 *  store/projectLock.ts's header for the full booked scope). A toast
 *  explains a read-only result with the two named next steps (Take Over
 *  Editing / Open as Copy — commands/projectLockCommands.ts). `openProject`
 *  itself never throws (see that module's own doc), so no `.catch` is
 *  needed here; releasing goes straight through `prior.provider.release`
 *  (not the `releaseLock` action, which reads LIVE store state that
 *  `reserveLockForSwitch` has already overwritten by the time this runs). */
function registerWithLockStateMachine(native: ProjectIdentity | undefined, prior: PriorLock | null): void {
  if (!native || !prior) return;
  void (async () => {
    if (prior.path && prior.path !== native.path && canRelease(prior.record, prior.instanceId)) {
      await prior.provider.release(prior.path, prior.record?.token ?? "").catch(() => false);
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

/** DEFECT A fix (2026-08-21, Sol audit item P1-6): record a Recent Projects
 *  entry ONLY once a native open is actually APPLIED to the session, never
 *  before. The native read itself (lib/openWorkspaceCommand.ts's
 *  `openWorkspaceCommand`) can succeed while the caller still declines to
 *  load it — "open-workspace"/"open-workspace-safe" gate the replace behind
 *  an async `askConfirm("Replace the current workspace?")` a user can
 *  Cancel — so pushing at the READ used to record files the user explicitly
 *  backed out of loading. `replaceWorkspace`/`replaceWorkspaceSafely` below
 *  are the single choke point every accepted replace passes through
 *  (fileCommands.ts's two open commands AND recentProjectsCommands.ts's
 *  "Open recent project…" reopen all call one of these two, never
 *  `loadWorkspace` directly), so pushing HERE — after `loadWorkspace` has
 *  actually run — is provably gated on acceptance without needing a second
 *  "did the confirm say yes" signal threaded through. `append-workspace`
 *  does not call either of these (appendWorkspace merges rather than
 *  replacing, and never gates on a confirm at all — see fileCommands.ts's
 *  own comment), so it pushes at ITS commit point instead
 *  (fileCommands.ts's append-workspace dispatch) — same rule, different
 *  chokepoint, because there IS no shared "apply" function to hang it on
 *  there. A browser-picker open (`native` undefined) still never records
 *  (unchanged from before — lib/recentProjects.ts's module doc). */
function recordNativeOpen(native: ProjectIdentity | undefined): void {
  if (!native) return;
  useRecentProjects.getState().pushRecentProject(native.name, native.path);
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
  // P3: reserve the lock machine's `path` at the NEW identity BEFORE
  // `setCurrentProject` flips `useApp.currentProject` — see
  // `reserveLockForSwitch`'s doc for why the ordering itself is the fix.
  const priorLock = reserveLockForSwitch(native);
  s().setCurrentProject(native ?? null);
  stageWorkspaceRestore(s().plotWindows, s().focusedWindowId);
  registerWithLockStateMachine(native, priorLock);
  recordNativeOpen(native); // DEFECT A — see recordNativeOpen's doc
}

/** "Open Without Layout…" (PR E2's safe-open) — same replace as
 *  `replaceWorkspace` above, but `loadWorkspace`'s `skipLayout` option drops
 *  the incoming plotWindows/focusedWindowId/toolWindowLayout and lands on
 *  the single fresh window every layout-less doc already gets; everything
 *  else restores normally. */
export function replaceWorkspaceSafely(s: StoreGet, ws: LoadedWorkspace, native?: ProjectIdentity): void {
  s().recordHistory("open workspace without layout");
  s().loadWorkspace(ws, { skipLayout: true });
  const priorLock = reserveLockForSwitch(native); // P3 — see replaceWorkspace's identical comment
  s().setCurrentProject(native ?? null);
  stageWorkspaceRestore(s().plotWindows, s().focusedWindowId);
  registerWithLockStateMachine(native, priorLock);
  recordNativeOpen(native); // DEFECT A — see recordNativeOpen's doc
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
