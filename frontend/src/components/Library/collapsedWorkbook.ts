// A single-sheet workbook renders as ONE Library row (lib/libraryHierarchy's
// collapsedSheetOf): a DatasetRow that ACTS AS THE WORKBOOK for the
// workbook-level things -- drag, Move to folder, rename, Re-import all,
// Combine, Copy/Duplicate, Reveal source, Delete -- and as the sheet for the
// data things. This file holds the pure pieces DatasetRow splices in so the
// row component stays under its ceiling:
//   - the menu additions (merged with, never replacing, the dataset menu).
// The store-touching halves -- the rename that keeps workbook and sheet names
// identical and the move that targets the WORKBOOK (a sheet's folder placement
// follows its workbook, so moveDatasetsToFolder no-ops for a workbook-owned
// sheet: the PR #741 regression) -- live in store/collapsedWorkbookActions.ts.

import { buildMenuItems, runContextAction } from "../../lib/contextActions";
import type { FolderNode } from "../../lib/types";
import type { WorkbookLibraryNode } from "../../lib/libraryHierarchy";
import {
  workbookCoreActions,
  workbookDeleteActions,
  workbookSourceActions,
  type WorkbookActionTarget,
} from "../../lib/workbookContextActions";
import { moveToFolderViaWorkbooks } from "../../store/collapsedWorkbookActions";
import type { ContextMenuItem } from "../overlays/ContextMenu";

/** Dataset actions the workbook's own entry replaces on a collapsed row:
 *  Duplicate/Rename would otherwise act on the sheet alone (a second sheet
 *  re-expands the workbook; a sheet-only rename desyncs the two names). */
export const COLLAPSED_SKIPPED_DATASET_ACTIONS: ReadonlySet<string> = new Set(["dataset.duplicate", "dataset.rename"]);

/** The per-folder "Move to ..." entries for a collapsed row. */
export function collapsedMoveItems(
  workbook: WorkbookLibraryNode,
  moveIds: readonly string[],
  folders: readonly FolderNode[],
): ContextMenuItem[] {
  const label = (dest: string) => (moveIds.length > 1 ? `Move ${moveIds.length} selected to ${dest}` : `Move to ${dest}`);
  return [
    ...folders.map((f): ContextMenuItem => ({
      label: label(`"${f.name}"`),
      run: () => moveToFolderViaWorkbooks(moveIds, f.id),
      disabled: moveIds.length === 1 && workbook.entity.folderId === f.id,
    })),
    ...(workbook.entity.folderId || moveIds.length > 1
      ? [{ label: label("top level"), run: () => moveToFolderViaWorkbooks(moveIds, null) } as ContextMenuItem]
      : []),
  ];
}

/** The workbook-level entries a collapsed row adds to its dataset menu, split
 *  by where the row menu files them (datasetRowMenu.ts groups them under
 *  Source / Derive, so the row stays within the item ceiling). */
export interface CollapsedWorkbookGroups {
  /** "Focus on this workbook" (absent outside a focusable view). */
  focus: ContextMenuItem[];
  rename: ContextMenuItem[];
  /** Copy, Duplicate. */
  copyDuplicate: ContextMenuItem[];
  /** Re-import all / available sources, Reveal source. */
  source: ContextMenuItem[];
  /** Combine… */
  combine: ContextMenuItem[];
  properties: ContextMenuItem[];
}

export function collapsedWorkbookGroups(
  workbook: WorkbookLibraryNode,
  onRename: () => void,
  onStageOpen?: () => void,
  onFocus?: () => void,
): CollapsedWorkbookGroups {
  const target: WorkbookActionTarget = { node: workbook, onRename, onStageOpen };
  const pick = (ids: string[]) => buildMenuItems(workbookCoreActions.filter((a) => ids.includes(a.id)), target);
  return {
    focus: onFocus ? [{ label: "Focus on this workbook", run: onFocus }] : [],
    // "Browse" is a Tiles-view command (no onBrowse here): never offered on a collapsed row.
    rename: pick(["workbook.rename"]),
    copyDuplicate: pick(["workbook.copy", "workbook.duplicate"]),
    source: [
      ...pick(["workbook.reimportAll", "workbook.reimportAvailable"]),
      ...buildMenuItems(workbookSourceActions.filter((a) => a.id === "workbook.revealSource"), target),
    ],
    combine: pick(["workbook.combine"]),
    properties: buildMenuItems(workbookSourceActions.filter((a) => a.id === "workbook.properties"), target),
  };
}

/** Keyboard Delete on a lone collapsed row: the workbook's own confirmed
 *  delete (same L0.45 gate and confirm the menu item uses). */
export function deleteCollapsedWorkbook(workbook: WorkbookLibraryNode): void {
  const del = workbookDeleteActions[0];
  const target = { node: workbook, onRename: () => {} };
  if (del.enabled?.(target) === false) return;
  runContextAction(del, target);
}

/** Delete for a collapsed row acts on the WORKBOOK (grouping + sheet, one
 *  confirm, one Undo) unless the row is part of a multi-selection, where the
 *  dataset registry's "Remove N selected" owns it. */
export function collapsedDeleteItems(workbook: WorkbookLibraryNode): ContextMenuItem[] {
  return buildMenuItems(workbookDeleteActions, { node: workbook, onRename: () => {} });
}
