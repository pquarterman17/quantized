// The first WORKBOOK mutations (LIBRARY_WORKBOOK_UX_PLAN PR C) — composed
// into useApp exactly like store/datasetMeta.ts (see that file's header):
// owns no state of its own, mutates the shared `workbooks`/`datasets` fields
// through set/get like every other slice acting on state it doesn't own.
// `workbooks` already rides HistorySnapshot (added ahead of any mutator in
// PR A2, see history.ts), so every action here inherits undo for free.

import { removeDatasetsPatch } from "./removeDatasets";
import type { AppState } from "./useApp";

/** L0.45 fail-closed gate (PR #139 review, round 3): workbook Delete is
 *  disabled UNCONDITIONALLY until PR M's dependency-aware Trash. Even with
 *  zero dependent artifacts, Trash today stores only individual Dataset
 *  snapshots — deleting a workbook loses the grouping itself (id, name,
 *  order, folder, source provenance, membership), and restoring sheets one
 *  at a time re-derives SEPARATE workbooks. That contradicts L0.45's "the
 *  workbook moves to recoverable Trash", so the command stays visible but
 *  disabled with this stable reason (disable-don't-remove, L0.36) rather
 *  than shipping a partial second Trash format inside PR C. Individual
 *  worksheet Delete is unaffected. Shared by the menu registry
 *  (lib/workbookContextActions.ts), the tree's Delete-key path, and
 *  `deleteWorkbook` itself, so no caller can bypass the gate; PR M lifts it
 *  by making this return null when the atomic workbook package exists. */
export function workbookDeleteBlockers(_s: AppState, _workbookId: string): string | null {
  return "Workbook Delete arrives with dependency-aware Trash (PR M)";
}

export interface WorkbookActionsSlice {
  /** Blank name = no-op (matches renameFolder/renameDataset's own guard). */
  renameWorkbook: (id: string, name: string) => void;
  /** A2 folder placement is owned by the workbook (lib/workbooks.ts's header):
   *  moving a workbook re-homes every member dataset's `folderId` in the same
   *  action so search/reveal/smart-folders — every legacy consumer that still
   *  reads `Dataset.folderId` directly — stay in sync. */
  moveWorkbookToFolder: (id: string, folderId: string | null) => void;
  /** L0.22/L0.45: fail-closed no-op until PR M lifts
   *  `workbookDeleteBlockers` (see its doc). The body below is the intended
   *  post-M shape — ONE atomic update under ONE history entry via the shared
   *  removeDatasetsPatch — but M must ALSO make Trash workbook-aware before
   *  enabling it, or restore still can't rebuild the grouping. */
  deleteWorkbook: (id: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createWorkbookActionsSlice(set: SliceSet, get: SliceGet): WorkbookActionsSlice {
  return {
    renameWorkbook: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      get().recordHistory("rename workbook");
      set((s) => ({
        workbooks: s.workbooks.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
      }));
    },

    moveWorkbookToFolder: (id, folderId) => {
      get().recordHistory("move workbook");
      set((s) => ({
        workbooks: s.workbooks.map((w) => (w.id === id ? { ...w, folderId: folderId ?? undefined } : w)),
        datasets: s.datasets.map((d) => (d.workbookId === id ? { ...d, folderId: folderId ?? undefined } : d)),
      }));
    },

    deleteWorkbook: (id) => {
      const s = get();
      if (!s.workbooks.some((w) => w.id === id)) return;
      if (workbookDeleteBlockers(s, id) != null) return; // fail closed — the menu shows the reason
      const memberIds = s.datasets.filter((d) => d.workbookId === id).map((d) => d.id);
      // ONE history entry, ONE set() (PR #139 review): the same
      // removeDatasetsPatch the removeDatasets ACTION applies — members land
      // in the SAME recoverable Trash with the SAME reference pruning, never
      // a second divergent delete mechanism — composed with the workbook
      // removal so a single Undo restores workbook + members together.
      get().recordHistory("delete workbook");
      get().sendToTrash(s.datasets.filter((d) => memberIds.includes(d.id)));
      set((s2) => ({
        ...removeDatasetsPatch(s2, memberIds),
        workbooks: s2.workbooks.filter((w) => w.id !== id),
      }));
    },
  };
}
