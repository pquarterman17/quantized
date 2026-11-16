// "Remove all" takes the open project with it (identity + lock, so a save can
// never write an emptied workspace over the project file); its Undo must give
// the project back, and its Redo must take it away again — whichever way the
// undo/redo is driven (the toast, Edit ▸ Undo/Redo, Ctrl+Z).
//
// The history entry itself does not carry the project (the undo snapshot is an
// allowlist of workspace data, and history.ts is at its size ceiling), so this
// follows the entries from outside, the way store/curveFitRemove.ts follows a
// removed fit: a store subscription sees a "remove all" entry move onto the
// redo stack (undone -> re-attach) or back onto the undo stack (redone ->
// detach). Undo/redo re-push an entry under a fresh seq and object, so entries
// are matched by ORDINAL among the "remove all" entries of the undo stack
// (one record per Remove all, null when no project was open), not by identity.
// Known limit: evicting an old "remove all" entry past HISTORY_DEPTH shifts the
// ordinals; the guards below (nothing attached, no other project) bound the harm.
//
// Re-attaching is honest, not optimistic: the project is marked unsaved (the
// tool-window layout, recalc mode and library selection are not part of the
// snapshot, so the restored session is not byte-identical to what was saved),
// and the lock is genuinely re-acquired — after the earlier release has landed
// (else the heartbeat could see our own stale release and demote to
// read-only). If another instance took the project meanwhile, the work comes
// back read-only with the usual reason and next step. If ANOTHER project is
// open (it would receive this one's data), the undo is reverted at once.

import { readOnlyOpenReason } from "../lib/openWorkspaceReplace";
import type { ProjectIdentity } from "./project";
import { useProjectLock } from "./projectLock";
import { isCurrentProjectLockOperation } from "./projectLockEpoch";
import { closeProjectLockAwaitable, reserveProjectLock } from "./projectLockLifecycle";
import { BROWSER_AUTOSAVE_LOCK_PATH } from "./projectLockPaths";
import { toast } from "./toasts";
import { useApp } from "./useApp";

const LABEL = "remove all";

interface Removed {
  project: ProjectIdentity;
  /** The release of the lock Remove all closed (awaited before re-acquiring). */
  released: Promise<unknown>;
}

/** One record per "remove all" entry on the undo stack, oldest first. */
const records: (Removed | null)[] = [];
let watching = false;
/** True from `beginRemoveAll` to `rememberRemovedProject`: the new entry's own push is not an undo/redo. */
let suspended = false;

const ordinalCount = (h: readonly { label: string }[]): number => h.filter((e) => e.label === LABEL).length;

/** Call just BEFORE `clearAll` records its entry. */
export function beginRemoveAll(): void {
  suspended = true;
  watch();
}

/** A clear that threw recorded nothing: stop ignoring undo/redo. */
export function cancelRemoveAll(): void {
  suspended = false;
}

/** Another (named) project is open or mid-open. The browser's autosave slot
 *  holds a synthetic lock path for the whole session — that is not a project. */
function otherProjectOpen(): boolean {
  const path = useProjectLock.getState().path;
  return useApp.getState().currentProject !== null || (path !== null && path !== BROWSER_AUTOSAVE_LOCK_PATH);
}

/** Call right AFTER the Remove all took effect: remember the project that was
 *  open (null: none was). */
export function rememberRemovedProject(project: ProjectIdentity | null, released: Promise<unknown>): void {
  const ordinal = ordinalCount(useApp.getState().history) - 1;
  records.length = Math.max(0, ordinal); // a new entry invalidates any redo-side records
  records[ordinal] = project ? { project, released } : null;
  suspended = false;
}

function watch(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if (suspended) return;
    const undone = s.future.at(-1);
    if (undone !== prev.future.at(-1) && undone?.label === LABEL) {
      const r = records[ordinalCount(s.history)];
      if (r) attach(r);
    }
    const redone = s.history.at(-1);
    if (redone !== prev.history.at(-1) && redone?.label === LABEL) {
      const r = records[ordinalCount(s.history) - 1];
      if (r) detach(r);
    }
  });
}

/** Why an Undo of Remove all must be refused right now (BEFORE it restores
 *  anything), or null: another project is open (or opening) and would receive
 *  this one's data. */
export function removeAllUndoBlock(): string | null {
  return otherProjectOpen()
    ? "another project is open now — undo would put this one's data into it"
    : null;
}

function attach(r: Removed): void {
  const s = useApp.getState();
  if (otherProjectOpen()) {
    // Moved on (Edit > Undo / Ctrl+Z cannot be refused up front): the data was
    // just restored into the OTHER project's workspace — put it straight back.
    suspended = true;
    s.redo();
    suspended = false;
    toast("Can't undo Remove all — another project is open and would receive this one's data.", "info");
    return;
  }
  const reservation = reserveProjectLock(r.project.path);
  s.setCurrentProject(r.project);
  s.markProjectDirty(); // see the header: not byte-identical to the saved file
  // A Redo / second Remove all / other open before the release lands supersedes
  // this reservation: then acquire nothing (it would leak a lock on a closed project).
  void r.released
    .then(() => (isCurrentProjectLockOperation(reservation) ? useProjectLock.getState().openProject(r.project.path) : null))
    .then((res) => {
      if (res?.readOnly) toast(`"${r.project.name}": ${readOnlyOpenReason(res.status)}`, "info");
    })
    .catch(() => undefined); // openProject itself never throws; a failed release is already best-effort
}

function detach(r: Removed): void {
  const s = useApp.getState();
  if (s.currentProject?.path !== r.project.path) return; // not ours to detach
  r.released = closeProjectLockAwaitable();
  s.setCurrentProject(null);
}
