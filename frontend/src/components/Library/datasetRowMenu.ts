// The Library dataset row's full context-menu item list — extracted out of
// DatasetRow.tsx (which sits AT the .tsx component-ceiling ratchet's 400-line
// pin with zero headroom, architecture.test.ts) so new row features land
// without pushing the component over — GUI_INTERACTION_PLAN #13's drag
// handle, "Show in folder", and folder-path caption all needed a few more
// lines in the row itself.
//
// GUI_INTERACTION #8: the fixed (non-per-folder) items now come from the
// shared `lib/datasetContextActions.ts` dataset registry via `buildMenuItems` —
// each action is defined once (id/label/enabled/run) and this builder's job
// shrinks to composing the registry groups around the one genuinely dynamic
// block, the per-folder "Move to …" list (one entry per LIVE folder, which
// can't be a fixed registry entry). `actionMenuItem`'s `run` already routes
// destructive entries (Remove / Remove N selected) through the shared
// confirm step — this builder no longer needs to know that policy exists.
//
// Pure function: reads `useApp.getState()` directly for `selectedIds`
// (matching the EXACT non-reactive read the original inline code used —
// this is evaluated once per DatasetRow render, not a subscribed hook).

import { buildMenuItems, runContextAction, type DatasetActionTarget } from "../../lib/contextActions";
import {
  datasetCoreActions,
  datasetCorrectionsActions,
  datasetMoveActions,
  datasetMultiSelectActions,
  datasetNewFolderAction,
  datasetRemoveActions,
} from "../../lib/datasetContextActions";
import { datasetCombineSeparateActions } from "../../lib/combineSeparateActions";
import { datasetDerivedWorksheetActions } from "../../lib/derivedWorksheetActions";
import { datasetSourceRowsActions } from "../../lib/sourceRowsAction";
import { datasetMetaFactorsAction } from "../../lib/metaFactorsAction";
import { withQuickPlot } from "../../lib/quickPlotActions";
import type { WorkbookLibraryNode } from "../../lib/libraryHierarchy";
import type { Dataset, FolderNode } from "../../lib/types";
import {
  COLLAPSED_SKIPPED_DATASET_ACTIONS,
  collapsedDeleteItems,
  collapsedMoveItems,
  collapsedWorkbookGroups,
} from "./collapsedWorkbook";
import { joinGroups, submenuItem } from "./rowMenuGroups";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

export function buildDatasetRowMenu(
  d: Dataset,
  active: boolean,
  selected: boolean,
  folders: FolderNode[],
  canMoveUp: boolean,
  canMoveDown: boolean,
  onRename: () => void,
  onAddTag: () => void,
  onStageOpen?: () => void,
  /** The single-sheet workbook this row stands for (collapsedWorkbook.ts). */
  workbook?: WorkbookLibraryNode,
  onFocusWorkbook?: () => void,
): ContextMenuItem[] {
  const { selectedIds } = useApp.getState();
  // A collapsed row can read "selected" through its WORKBOOK's selection alone;
  // only the dataset selection decides what a bulk action targets.
  if (workbook && !selectedIds.includes(d.id)) selected = false;
  const selectedCount = selectedIds.length;
  const target: DatasetActionTarget = {
    dataset: d,
    active,
    selected,
    selectedIds,
    canMoveUp,
    canMoveDown,
    onRename,
    onAddTag,
    onStageOpen,
  };
  // Move acts on the whole multi-selection when this row is part of one (bulk
  // move — item 8); otherwise on this row alone.
  const moveIds = selected && selectedCount > 1 ? selectedIds : [d.id];
  const moveLabel = (dest: string) =>
    moveIds.length > 1 ? `Move ${moveIds.length} selected to ${dest}` : `Move to ${dest}`;
  const moveToFolder = useApp.getState().moveDatasetsToFolder; // one undo step for the whole selection

  const core = withQuickPlot(datasetCoreActions).filter((a) => !workbook || !COLLAPSED_SKIPPED_DATASET_ACTIONS.has(a.id));
  const pick = (ids: string[]) => buildMenuItems(core.filter((a) => ids.includes(a.id)), target);
  const wb = workbook ? collapsedWorkbookGroups(workbook, onRename, onStageOpen, onFocusWorkbook) : null;
  const multi = selected && selectedCount > 1;

  // Move into a folder (project-organization item 3): one "Move" submenu with
  // the folder list, the out-to-root option, create-a-new-folder-with-this, and
  // the (rarely live) manual Move up / Move down. A collapsed single-sheet
  // workbook moves AS the workbook: a sheet's placement follows it, so the
  // dataset move would no-op.
  const folderItems: ContextMenuItem[] = workbook
    ? collapsedMoveItems(workbook, moveIds, folders)
    : [
        ...folders.map(
          (f): ContextMenuItem => ({
            label: moveLabel(`"${f.name}"`),
            run: () => moveToFolder(moveIds, f.id),
            disabled: moveIds.length === 1 && d.folderId === f.id,
          }),
        ),
        ...(d.folderId || moveIds.length > 1
          ? [{ label: moveLabel("top level"), run: () => moveToFolder(moveIds, null) } as ContextMenuItem]
          : []),
      ];
  const moveMenu = submenuItem("Move", joinGroups(
    folderItems,
    [...buildMenuItems([datasetNewFolderAction], target), ...pick(["dataset.showInFolder"])],
    buildMenuItems(datasetMoveActions, target),
  ));

  // The rest of the sheet's derive / combine / split family, one submenu.
  const deriveMenu = submenuItem("Derive and combine", joinGroups(
    // Batch-apply this dataset's corrections (only when it has any).
    d.corrections ? buildMenuItems(datasetCorrectionsActions, target) : [],
    // PR K slice 2 (L0.50): each entry gates its OWN visibility (hidden).
    [...buildMenuItems([...datasetDerivedWorksheetActions, datasetMetaFactorsAction], target), ...pick(["dataset.split", "dataset.mapOperations"])],
    // PR J slice 2: Combine (multi-selection only, gates itself) / Separate.
    [...(wb?.combine ?? []), ...buildMenuItems(datasetCombineSeparateActions, target)],
  ));

  // Merge / panel / overlay quick picks for the multi-selection (item 19).
  const selectedMenu = multi ? submenuItem(`${selectedCount} selected`, buildMenuItems(datasetMultiSelectActions, target)) : [];

  return joinGroups(
    // withQuickPlot (lib/quickPlotActions.ts): L0.38's ordering splices Quick
    // Plot right after the "plot" group, shared with paletteContextActions.ts
    // so the two menu surfaces can't drift apart. The less common ways of
    // opening a sheet sit in "Open".
    [
      ...pick(["dataset.plot", "dataset.plotInNewWindow", "dataset.quickPlot"]),
      ...submenuItem("Open", joinGroups(
        pick(["dataset.openMap", "dataset.openWorksheetWindow", "dataset.techniqueWorkspace"]),
        pick(["dataset.configureQuickPlot", "dataset.quickPlotWith"]),
        buildMenuItems(datasetSourceRowsActions, target), // a linked subset: back to its source rows
        wb?.focus ?? [],
      )),
    ],
    [
      ...(wb ? wb.rename : pick(["dataset.rename"])),
      ...pick(["dataset.addTag"]),
      ...(wb ? wb.copyDuplicate : pick(["dataset.duplicate"])),
    ],
    [
      // Re-import (one spelling) and the source file's own entries.
      ...submenuItem("Source", [...pick(["dataset.reimport", "dataset.autoUpdate", "dataset.autoUpdateNow"]), ...(wb?.source ?? [])]),
      ...moveMenu,
      ...deriveMenu,
      ...selectedMenu,
      ...(wb?.properties ?? []),
    ],
    // A lone collapsed row deletes the WORKBOOK (grouping + sheet, one Undo);
    // inside a multi-selection the dataset registry's "Remove N selected" owns it.
    workbook && !multi ? collapsedDeleteItems(workbook) : buildMenuItems(datasetRemoveActions, target),
  );
}

/** Remove a dataset through the SAME registry action the row's context menu
 *  uses, so the shared confirm step cannot be bypassed.
 *
 *  GUI_INTERACTION #17: the row's footer "✕" icon button used to call
 *  `removeDataset(d.id)` straight on the store. That made TWO paths to one
 *  irreversible deletion — the menu entry (`dataset.remove`, `destructive:
 *  true`, confirmed with the dataset's name) and a bare icon whose only
 *  affordance was a hover title. Routing the button here fixes the mechanism
 *  rather than the instance: there is one definition of "remove a dataset"
 *  and the confirm is structural. Looked up BY ID, never by array index, so
 *  reordering the registry can't silently re-open the hole. */
export function removeDatasetConfirmed(d: Dataset): void {
  const action = datasetRemoveActions.find((a) => a.id === "dataset.remove");
  if (!action) throw new Error("dataset.remove missing from the context-action registry");
  const { selectedIds } = useApp.getState();
  runContextAction(action, {
    dataset: d,
    active: false,
    selected: false,
    selectedIds,
    canMoveUp: false,
    canMoveDown: false,
    onRename: () => {},
    onAddTag: () => {},
  });
}
