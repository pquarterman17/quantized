// The first WORKBOOK mutations (LIBRARY_WORKBOOK_UX_PLAN PR C) — composed
// into useApp exactly like store/datasetMeta.ts (see that file's header):
// owns no state of its own, mutates the shared `workbooks`/`datasets` fields
// through set/get like every other slice acting on state it doesn't own.
// `workbooks` already rides HistorySnapshot (added ahead of any mutator in
// PR A2, see history.ts), so every action here inherits undo for free.

import type { AppState } from "./useApp";

export interface WorkbookActionsSlice {
  /** Blank name = no-op (matches renameFolder/renameDataset's own guard). */
  renameWorkbook: (id: string, name: string) => void;
  /** A2 folder placement is owned by the workbook (lib/workbooks.ts's header):
   *  moving a workbook re-homes every member dataset's `folderId` in the same
   *  action so search/reveal/smart-folders — every legacy consumer that still
   *  reads `Dataset.folderId` directly — stay in sync. */
  moveWorkbookToFolder: (id: string, folderId: string | null) => void;
  /** L0.22/L0.45: the visible command is "Delete", but every member dataset
   *  routes through the SAME recoverable Trash path a plain dataset delete
   *  uses (store/trash.ts) before the workbook node itself is removed — the
   *  M-owned dependency review is deliberately NOT built here (PR M). */
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
      const memberIds = s.datasets.filter((d) => d.workbookId === id).map((d) => d.id);
      // DELEGATES to removeDatasets (mirrors folderOps.ts's
      // removeFolderWithDatasets) so members land in the SAME recoverable
      // Trash a plain dataset delete uses, with the SAME reference pruning
      // (origin figures, fidelity, reports, figure docs, plot windows) —
      // never a second, divergent delete mechanism. Two history entries
      // (like removeFolderWithDatasets), each independently undoable.
      if (memberIds.length > 0) get().removeDatasets(memberIds);
      get().recordHistory("delete workbook");
      set((s2) => ({ workbooks: s2.workbooks.filter((w) => w.id !== id) }));
    },
  };
}
