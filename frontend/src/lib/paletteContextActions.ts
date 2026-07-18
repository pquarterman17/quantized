// GUI_INTERACTION #8's "Command Palette reuses the SAME entries" consumer:
// bridges the context-action registry (this file's own `contextActions` +
// `Stage/annotationShapeActions`) into the ⌘K Command Palette, so the active
// dataset / selected annotation / selected shape's actions are reachable
// without a mouse. Read at CALL time (palette-open, see CommandPalette.tsx's
// own effect) — non-reactive by design, the same snapshot discipline that
// module already uses for `menuCommands`.
//
// Two dataset actions normally open a Library row's own inline editor
// (Rename…/Add tag…) — there is no such row focused from the palette, so
// here they fall back to the modal `ParamDialog` (`askParams`) instead.
//
// Deliberately NOT covered yet:
//  - Folder actions: the store has no "active folder" concept today, so
//    there is no target to build.
//  - Worksheet column/row actions: their `ColumnMenuContext`/`RowMenuContext`
//    only exist inside a MOUNTED `WorksheetPane` (see worksheetMenus.ts),
//    not at the store level — nothing to read from `useApp.getState()` here.
// Both are future work for whenever those selections gain a store-level home.

import {
  annotationActions,
  shapeActions,
  type AnnotationActionTarget,
  type ShapeActionTarget,
} from "../components/Stage/annotationShapeActions";
import { askParams } from "../components/overlays/ParamDialog";
import type { Action } from "../store/commands";
import { useApp } from "../store/useApp";
import { actionPaletteEntry, datasetActions, type DatasetActionTarget } from "./contextActions";

function renameDatasetDialog(id: string, name: string): void {
  void askParams(`Rename "${name}"`, [{ key: "name", label: "Name", type: "text", default: name }]).then(
    (result) => {
      const next = result && String(result.name).trim();
      if (next) useApp.getState().renameDataset(id, next);
    },
  );
}

function addDatasetTagDialog(id: string, name: string): void {
  void askParams(`Add tag to "${name}"`, [{ key: "tag", label: "Tag", type: "text", default: "" }]).then(
    (result) => {
      const tag = result && String(result.tag).trim();
      if (tag) useApp.getState().addDatasetTag(id, tag);
    },
  );
}

export function contextPaletteActions(): Action[] {
  const s = useApp.getState();
  const out: Action[] = [];

  const active = s.datasets.find((d) => d.id === s.activeId);
  if (active) {
    const idx = s.datasets.findIndex((d) => d.id === active.id);
    const target: DatasetActionTarget = {
      dataset: active,
      active: true,
      selected: s.selectedIds.includes(active.id),
      selectedIds: s.selectedIds,
      canMoveUp: idx > 0,
      canMoveDown: idx >= 0 && idx < s.datasets.length - 1,
      onRename: () => renameDatasetDialog(active.id, active.name),
      onAddTag: () => addDatasetTagDialog(active.id, active.name),
    };
    const group = `Active dataset — ${active.name}`;
    for (const a of datasetActions) {
      const entry = actionPaletteEntry(a, target, group, "ctx.dataset");
      if (entry) out.push(entry);
    }
  }

  const annId = s.selectedAnnotationId;
  if (annId && s.annotations.some((a) => a.id === annId)) {
    const target: AnnotationActionTarget = { id: annId, conv: null };
    for (const a of annotationActions) {
      const entry = actionPaletteEntry(a, target, "Selected annotation", "ctx.annotation");
      if (entry) out.push(entry);
    }
  }

  const shapeId = s.selectedShapeId;
  if (shapeId && s.shapes.some((x) => x.id === shapeId)) {
    const target: ShapeActionTarget = { id: shapeId, conv: null };
    for (const a of shapeActions) {
      const entry = actionPaletteEntry(a, target, "Selected shape", "ctx.shape");
      if (entry) out.push(entry);
    }
  }

  return out;
}
