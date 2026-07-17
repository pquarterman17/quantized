// The Library dataset row's full context-menu item list — extracted out of
// DatasetRow.tsx (which sits AT the .tsx component-ceiling ratchet's 400-line
// pin with zero headroom, architecture.test.ts) so new row features land
// without pushing the component over — GUI_INTERACTION_PLAN #13's drag
// handle, "Show in folder", and folder-path caption all needed a few more
// lines in the row itself.
//
// GUI_INTERACTION #8: the fixed (non-per-folder) items now come from the
// shared `lib/contextActions.ts` dataset registry via `buildMenuItems` —
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

import {
  buildMenuItems,
  datasetCoreActions,
  datasetCorrectionsActions,
  datasetMoveActions,
  datasetMultiSelectActions,
  datasetNewFolderAction,
  datasetRemoveActions,
  type DatasetActionTarget,
} from "../../lib/contextActions";
import type { Dataset, FolderNode } from "../../lib/types";
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
): ContextMenuItem[] {
  const { selectedIds } = useApp.getState();
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
  };
  // Move acts on the whole multi-selection when this row is part of one (bulk
  // move — item 8); otherwise on this row alone.
  const moveIds = selected && selectedCount > 1 ? selectedIds : [d.id];
  const moveLabel = (dest: string) =>
    moveIds.length > 1 ? `Move ${moveIds.length} selected to ${dest}` : `Move to ${dest}`;
  const moveToFolder = useApp.getState().moveDatasetToFolder;

  return [
    ...buildMenuItems(datasetCoreActions, target),
    // Move into a folder (project-organization item 3). Flat list of folders +
    // an out-to-root option + create-a-new-folder-with-this. (Drag onto a folder
    // header does the same.)
    { separator: true },
    ...folders.map(
      (f): ContextMenuItem => ({
        label: moveLabel(`"${f.name}"`),
        run: () => moveIds.forEach((id) => moveToFolder(id, f.id)),
        disabled: moveIds.length === 1 && d.folderId === f.id,
      }),
    ),
    ...(d.folderId || moveIds.length > 1
      ? [
          {
            label: moveLabel("top level"),
            run: () => moveIds.forEach((id) => moveToFolder(id, null)),
          } as ContextMenuItem,
        ]
      : []),
    ...buildMenuItems([datasetNewFolderAction], target),
    // Batch-apply this dataset's corrections (only when it has any).
    ...(d.corrections ? [{ separator: true } as ContextMenuItem, ...buildMenuItems(datasetCorrectionsActions, target)] : []),
    // Merge / panel / overlay quick picks for the multi-selection (item 19).
    ...(selected && selectedCount > 1
      ? [{ separator: true } as ContextMenuItem, ...buildMenuItems(datasetMultiSelectActions, target)]
      : []),
    { separator: true },
    ...buildMenuItems(datasetMoveActions, target),
    { separator: true },
    ...buildMenuItems(datasetRemoveActions, target),
  ];
}
