// Edit > Cut / Copy / Delete (UX9-J). Thin dispatchers onto the EXISTING
// per-focus behaviour — nothing here re-implements an edit:
//   cells         -> the worksheet's block ops (the Ctrl+C / Ctrl+X / Delete
//                    handlers' own functions, published by lib/editTargets)
//   plot object   -> the annotation / shape context-menu Delete action
//   Library items -> lib/datasetRemoval (the global Delete key's request path,
//                    so the "confirm before removing" preference still applies)
// Lazy-list only (appCommands.ts), so they carry their own description/keywords
// instead of a commandDocs entry (that table is for the eager core list).
// Each is disabled WITH a reason when nothing applies. The menu is evaluated
// when it opens, so the predicates read live state.

import { requestDatasetRemoval } from "../lib/datasetRemoval";
import { sheetBlockOps } from "../lib/editTargets";
import type { StoreGet } from "../lib/exportActive";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { Action } from "../store/commands";

const NO_CELLS = "Select worksheet cells first (Copy figure copies the plot)";

export function buildEditClipboardCommands(s: StoreGet): Action[] {
  const deleteIds = (): string[] => {
    const st = s();
    return st.selectedIds.length ? st.selectedIds : st.activeId ? [st.activeId] : [];
  };
  const hasObject = (): boolean => Boolean(s().selectedAnnotationId || s().selectedShapeId);
  return [
    {
      id: "edit-cut",
      group: "Edit",
      label: "Cut",
      description: "Copy the selected worksheet cells, then blank them (undoable).",
      keywords: "cut cells clipboard block worksheet",
      shortcut: "⌘X",
      disabled: () => sheetBlockOps() === null,
      disabledReason: NO_CELLS,
      run: () => sheetBlockOps()?.cutBlock(),
    },
    {
      id: "edit-copy",
      group: "Edit",
      label: "Copy",
      description: "Copy the selected worksheet cells to the clipboard (no header; pastes back cleanly).",
      keywords: "copy cells clipboard block worksheet",
      shortcut: "⌘C",
      disabled: () => sheetBlockOps() === null,
      disabledReason: NO_CELLS,
      run: () => sheetBlockOps()?.copyBlock(),
    },
    {
      id: "edit-delete",
      group: "Edit",
      label: "Delete",
      description: "Blank the selected worksheet cells, else delete the selected plot object, else remove the selected Library datasets.",
      keywords: "delete remove clear cells annotation shape library selection",
      shortcut: "Del",
      danger: true,
      disabled: () => !sheetBlockOps() && !hasObject() && deleteIds().length === 0,
      disabledReason: "Nothing selected to delete",
      run: () => {
        const ops = sheetBlockOps();
        if (ops) return ops.clearBlock();
        const { selectedAnnotationId: ann, selectedShapeId: shape } = s();
        if (ann || shape) {
          void runLazy("Loading…", () => import("../components/Stage/annotationShapeActions")).then((m) => {
            if (ann) m.annotationDeleteAction.run({ id: ann, conv: null });
            else if (shape) m.shapeDeleteAction.run({ id: shape, conv: null });
          }, onLoadFailure);
          return;
        }
        requestDatasetRemoval(deleteIds());
      },
    },
  ];
}
