// The Library dataset row's full context-menu item list — extracted out of
// DatasetRow.tsx (which sits AT the .tsx component-ceiling ratchet's 400-line
// pin with zero headroom, architecture.test.ts) so new row features land
// without pushing the component over — GUI_INTERACTION_PLAN #13's drag
// handle, "Show in folder", and folder-path caption all needed a few more
// lines in the row itself. Mirrors lib/panelMenu.ts's earlier
// multiSelectMenuItems extraction (same file, same reasoning, done first).
//
// Pure function: reads `useApp.getState()` directly for `selectedIds`/the
// full dataset list (matching the EXACT non-reactive read the original
// inline code used — this is evaluated once per DatasetRow render, not a
// subscribed hook), everything else is passed in.

import { multiSelectMenuItems, type MultiSelectMenuActions } from "../../lib/panelMenu";
import type { Dataset, FolderNode } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

export interface DatasetRowMenuActions extends MultiSelectMenuActions {
  setActive: (id: string) => void;
  duplicateDataset: (id: string) => void;
  reimportDataset: (id: string) => Promise<void> | void;
  openSplitDialog: (id: string) => void;
  moveDatasetToFolder: (id: string, folderId: string | null, beforeId?: string) => void;
  createFolder: (parentId: string | null, name?: string) => string;
  applyCorrectionsToMany: (id: string, ids: string[]) => Promise<void> | void;
  moveDataset: (id: string, direction: -1 | 1) => void;
  removeDataset: (id: string) => void;
  removeSelected: () => void;
  /** "Show in folder" (plan #13 sub-item 2) — no-op call site gates this on
   *  `d.folderId != null` before the item is even offered. */
  requestReveal: (id: string) => void;
  onRename: () => void;
  onAddTag: () => void;
}

export function buildDatasetRowMenu(
  d: Dataset,
  active: boolean,
  selected: boolean,
  folders: FolderNode[],
  canMoveUp: boolean,
  canMoveDown: boolean,
  actions: DatasetRowMenuActions,
): ContextMenuItem[] {
  const { selectedIds } = useApp.getState();
  const selectedCount = selectedIds.length;
  const allIds = useApp.getState().datasets.map((x) => x.id);
  // Move acts on the whole multi-selection when this row is part of one (bulk
  // move — item 8); otherwise on this row alone.
  const moveIds = selected && selectedCount > 1 ? selectedIds : [d.id];
  const moveLabel = (dest: string) =>
    moveIds.length > 1 ? `Move ${moveIds.length} selected to ${dest}` : `Move to ${dest}`;

  return [
    // Explicit plot-intent (item 15) — unlike the row click, this ALWAYS
    // rebinds the focused plot window, even for an Origin book under the
    // "worksheet" pref; it says "Plot" right there in the label.
    { label: "Plot (make active)", run: () => actions.setActive(d.id), disabled: active },
    { label: "Duplicate", run: () => actions.duplicateDataset(d.id) },
    { label: "Rename…", run: actions.onRename },
    { label: "Add tag…", run: actions.onAddTag },
    ...(d.folderId != null
      ? [{ label: "Show in folder", run: () => actions.requestReveal(d.id) } as ContextMenuItem]
      : []),
    {
      label: d.source ? "Re-import from source" : "Re-import from file…",
      run: () => void actions.reimportDataset(d.id),
    },
    { label: "Split by column value…", run: () => actions.openSplitDialog(d.id) },
    // Move into a folder (project-organization item 3). Flat list of folders +
    // an out-to-root option + create-a-new-folder-with-this. (Drag onto a folder
    // header does the same.)
    { separator: true },
    ...folders.map(
      (f): ContextMenuItem => ({
        label: moveLabel(`"${f.name}"`),
        run: () => moveIds.forEach((id) => actions.moveDatasetToFolder(id, f.id)),
        disabled: moveIds.length === 1 && d.folderId === f.id,
      }),
    ),
    ...(d.folderId || moveIds.length > 1
      ? [
          {
            label: moveLabel("top level"),
            run: () => moveIds.forEach((id) => actions.moveDatasetToFolder(id, null)),
          } as ContextMenuItem,
        ]
      : []),
    {
      label: "New folder with this…",
      run: () => actions.moveDatasetToFolder(d.id, actions.createFolder(null, "New Folder")),
    },
    // Batch-apply this dataset's corrections (only when it has any).
    ...(d.corrections
      ? [
          { separator: true } as ContextMenuItem,
          {
            label: "Apply corrections to all",
            run: () => void actions.applyCorrectionsToMany(d.id, allIds),
          } as ContextMenuItem,
          ...(selected && selectedCount > 1
            ? [
                {
                  label: `Apply corrections to ${selectedCount} selected`,
                  run: () => void actions.applyCorrectionsToMany(d.id, selectedIds),
                } as ContextMenuItem,
              ]
            : []),
        ]
      : []),
    // Merge / panel / overlay quick picks for the multi-selection (item 19).
    ...multiSelectMenuItems(selected, selectedCount, selectedIds, actions),
    { separator: true },
    { label: "Move up", run: () => actions.moveDataset(d.id, -1), disabled: !canMoveUp },
    { label: "Move down", run: () => actions.moveDataset(d.id, 1), disabled: !canMoveDown },
    { separator: true },
    {
      label: "Remove",
      run: () => {
        actions.removeDataset(d.id);
        toast(`removed ${d.name}`);
      },
      danger: true,
    },
    ...(selected && selectedCount > 1
      ? [
          {
            label: `Remove ${selectedCount} selected`,
            run: () => {
              const n = selectedCount;
              actions.removeSelected();
              toast(`removed ${n} datasets`);
            },
            danger: true,
          } as ContextMenuItem,
        ]
      : []),
  ];
}
