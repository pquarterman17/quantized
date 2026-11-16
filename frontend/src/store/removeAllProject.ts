// "Remove all" takes the open project with it (identity + lock, so a save can
// never write an emptied workspace over the project file); its Undo must give
// the project back, and its Redo must take it away again — whichever way the
// undo/redo is driven (the toast, Edit ▸ Undo/Redo, Ctrl+Z).
//
// The history entry itself does not carry the project (the undo snapshot is an
// allowlist of workspace data, and history.ts is at its size ceiling), so this
// follows the entry from outside, the way store/curveFitRemove.ts follows a
// removed fit: a store subscription sees the "remove all" entry move onto the
// redo stack (undone -> re-attach) or back onto the undo stack (redone ->
// detach). Entries are told apart by identity, not seq — undo/redo re-push the
// entry under a fresh seq.
//
// Re-attaching is honest, not optimistic: the project is marked unsaved (the
// tool-window layout, recalc mode and library selection are not part of the
// snapshot, so the restored session is not byte-identical to what was saved),
// and the lock is genuinely re-acquired — after the earlier release has landed
// (else the heartbeat could see our own stale release and demote to
// read-only). If another instance took the project meanwhile, the work comes
// back read-only with the usual reason and next step.

import { readOnlyOpenReason } from "../lib/openWorkspaceReplace";
import type { ProjectIdentity } from "./project";
import { useProjectLock } from "./projectLock";
import { closeProjectLockAwaitable, reserveProjectLock } from "./projectLockLifecycle";
import { toast } from "./toasts";
import { useApp } from "./useApp";

const LABEL = "remove all";

interface Removed {
  project: ProjectIdentity;
  /** The release of the lock Remove all closed (awaited before re-acquiring). */
  released: Promise<unknown>;
}

let removed: Removed | null = null;
let watching = false;

/** Call right AFTER the Remove all took effect: remember the project that was
 *  open (null: none was) and follow the entry's undo/redo from now on. */
export function rememberRemovedProject(project: ProjectIdentity | null, released: Promise<unknown>): void {
  removed = project ? { project, released } : null;
  if (!removed || watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if (!removed) return;
    const undone = s.future.at(-1);
    if (undone !== prev.future.at(-1) && undone?.label === LABEL) attach(removed);
    const redone = s.history.at(-1);
    if (redone !== prev.history.at(-1) && redone?.label === LABEL) detach(removed);
  });
}

/** Why an Undo of Remove all must be refused right now (BEFORE it restores
 *  anything), or null: another project is open (or opening) and would receive
 *  this one's data. */
export function removeAllUndoBlock(): string | null {
  if (!removed) return null;
  const s = useApp.getState();
  return s.currentProject !== null || useProjectLock.getState().path !== null
    ? "another project is open now — undo would put this one's data into it"
    : null;
}

function attach(r: Removed): void {
  const s = useApp.getState();
  if (s.currentProject !== null || useProjectLock.getState().path !== null) return; // moved on
  reserveProjectLock(r.project.path);
  s.setCurrentProject(r.project);
  s.markProjectDirty(); // see the header: not byte-identical to the saved file
  void r.released.then(() => useProjectLock.getState().openProject(r.project.path)).then((res) => {
    if (res.readOnly) toast(`"${r.project.name}": ${readOnlyOpenReason(res.status)}`, "info");
  });
}

function detach(r: Removed): void {
  const s = useApp.getState();
  if (s.currentProject?.path !== r.project.path) return; // not ours to detach
  r.released = closeProjectLockAwaitable();
  s.setCurrentProject(null);
}
