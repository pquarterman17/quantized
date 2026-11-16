// The open project (identity + lock) follows the history entries that swap the
// WHOLE workspace — "remove all" and "open workspace" — through ANY undo/redo
// (toast, Edit ▸ Undo/Redo, Ctrl+Z). Without this, undoing an open restores
// the previous workspace's data under the NEW project's name and lock, and
// the next Ctrl+S writes one project's data into another's file.
//
// The undo snapshot is an allowlist of workspace data and history.ts is at its
// size ceiling, so the identities live here, keyed by the entry's `seq`:
//   * a swap entry is pushed while the PREVIOUS project is still current
//     (recordHistory runs before the load/clear), so `before` is read from the
//     state the push replaced;
//   * Undo pops the entry onto the redo stack under a fresh seq, so the
//     subscriber (which sees both states) re-keys the record to it, notes the
//     project that was current at that moment as `after`, and switches to
//     `before`; Redo re-keys it back and switches to `after`;
//   * records of entries that fell off both stacks (HISTORY_DEPTH eviction, a
//     new edit clearing redo) are pruned. Keys are seqs, never positions, so
//     eviction cannot misalign them (an ordinal scheme attached an OLDER
//     project to a later entry — Ctrl+S then wrote B's data into A's file).
// An entry with no record (a clear that threw, a rewritten entry) is simply not
// followed: the project stays as it is, which fails closed.
//
// Switching is honest, not optimistic: the project is marked unsaved (tool
// layout, recalc mode and library selection are not part of the snapshot), the
// old lock is released and the new one REALLY acquired — after the release has
// landed (else the heartbeat could see our own stale release and demote to
// read-only). A superseding swap or open cancels a queued acquisition. If
// another instance took the project meanwhile, the work comes back read-only
// with the usual reason and next step.

import type { ProjectIdentity } from "./project";
import { useProjectLock } from "./projectLock";
import { isCurrentProjectLockOperation } from "./projectLockEpoch";
import { closeProjectLockAwaitable, pendingProjectLockRelease, reserveProjectLock } from "./projectLockLifecycle";
import { BROWSER_AUTOSAVE_LOCK_PATH, readOnlyOpenReason } from "./projectLockPaths";
import { toast } from "./toasts";
import { useApp } from "./useApp";

const SWAP_LABELS: ReadonlySet<string> = new Set(["remove all", "open workspace", "open workspace without layout"]);

interface Swap {
  before: ProjectIdentity | null;
  /** Known once the entry has been undone (the project then current). */
  after?: ProjectIdentity | null;
}

const swaps = new Map<number, Swap>();
let watching = false;
/** Install the subscription (idempotent). Call before the first swap can happen. */
export function followProjectHistory(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if (s.history === prev.history && s.future === prev.future) return;
    const ph = prev.history.at(-1);
    const pf = prev.future.at(-1);
    const h = s.history.at(-1);
    const f = s.future.at(-1);
    const undid = ph && f && s.future.length === prev.future.length + 1 && s.history.length === prev.history.length - 1 && f.label === ph.label;
    const redid = pf && h && s.history.length === prev.history.length + 1 && s.future.length === prev.future.length - 1 && h.label === pf.label;
    if (undid) {
      const rec = swaps.get(ph.seq);
      if (rec) {
        swaps.delete(ph.seq);
        rec.after = prev.currentProject;
        swaps.set(f.seq, rec);
        switchProject(rec.before);
      }
    } else if (redid) {
      const rec = swaps.get(pf.seq);
      if (rec) {
        swaps.delete(pf.seq);
        swaps.set(h.seq, rec);
        switchProject(rec.after ?? null);
      }
    } else if (h && h !== ph && SWAP_LABELS.has(h.label) && !swaps.has(h.seq)) {
      swaps.set(h.seq, { before: prev.currentProject }); // a new entry: the project it replaced
    }
    const live = new Set([...s.history, ...s.future].map((e) => e.seq));
    for (const seq of swaps.keys()) if (!live.has(seq)) swaps.delete(seq);
  });
}

/** Why an Undo of Remove all must be refused right now (BEFORE it restores
 *  anything), or null: another project is open (or opening) — a state no
 *  ordered undo chain reaches, so it means a project was opened without an
 *  undo step. The browser's autosave slot holds a synthetic lock path for the
 *  whole session; that is not a project. */
export function removeAllUndoBlock(): string | null {
  const path = useProjectLock.getState().path;
  const open = useApp.getState().currentProject !== null || (path !== null && path !== BROWSER_AUTOSAVE_LOCK_PATH);
  return open ? "another project is open now — undo would put this one's data into it" : null;
}

function switchProject(target: ProjectIdentity | null): void {
  const s = useApp.getState();
  if ((s.currentProject?.path ?? null) === (target?.path ?? null)) return;
  const released = Promise.all([pendingProjectLockRelease(), closeProjectLockAwaitable()]);
  s.setCurrentProject(target);
  if (!target) return;
  const reservation = reserveProjectLock(target.path);
  s.markProjectDirty(); // not byte-identical to the saved file (see the header)
  // A later swap / open supersedes this reservation: then acquire nothing (it would leak a lock).
  void released
    .then(() => (isCurrentProjectLockOperation(reservation) ? useProjectLock.getState().openProject(target.path) : null))
    .then((res) => {
      if (res?.readOnly) toast(`"${target.name}": ${readOnlyOpenReason(res.status)}`, "info");
    })
    .catch(() => undefined); // openProject never throws; a failed release is already best-effort
}
