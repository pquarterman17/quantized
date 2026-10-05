// The dataset context-action registry (GUI_INTERACTION #8), moved verbatim
// out of lib/contextActions.ts (bundle diet slice 22,
// plans/BUNDLE_HEADROOM.md). Its only consumers are the Library dataset row
// menu (`components/Library/datasetRowMenu.ts`) and the ⌘K palette's context
// entries (`lib/paletteContextActions.ts`), both already lazy, so the
// registry and what only it reaches (`lib/datasetRemoveActions.ts`) load with
// them instead of with the eager engine. Import it by path:
// lib/contextActions.ts keeps the engine and `DatasetActionTarget` and does
// not re-export this module, so the half cannot fold back into the eager
// bundle through it.

import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { multiSelected } from "./multiSelected";
import { plotInNewWindow } from "./plotInNewWindow";
import { plotSelectedTogether } from "./plotSelectedTogether";
import { useApp } from "../store/useApp";

// Grouped (not one flat array) so `datasetRowMenu.ts` can splice the
// genuinely-dynamic per-folder "Move to …" list (one entry per live folder —
// not representable as a fixed registry entry) between `datasetCoreActions`
// and `datasetNewFolderAction`, matching the pre-registry item order exactly.
// `datasetActions` below is the flat concatenation for anything that wants
// "every dataset action" (tests, a future Command Palette / Plot Objects
// tree consumer) without caring about menu layout.

export const datasetCoreActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.plot",
    label: "Plot (make active)",
    enabled: (t) => !t.active,
    run: (t) => {
      useApp.getState().setActive(t.dataset.id);
      t.onStageOpen?.();
    },
  },
  // Multi-plot discoverability: a plain Library click REBINDS the focused
  // window (unless pinned), so there was no direct "plot this dataset in a
  // NEW window" gesture — users could only discover multiple windows via
  // Graph Builder's "Create New Plot". Always enabled (unlike `dataset.plot`
  // above): even the already-active dataset is worth plotting again, styled
  // differently, side by side.
  {
    id: "dataset.plotInNewWindow",
    label: "Plot in new window",
    run: (t) => {
      void plotInNewWindow(t.dataset.id);
      t.onStageOpen?.();
    },
  },
  {
    id: "dataset.openWorksheetWindow",
    label: "Open worksheet in window",
    run: (t) => {
      const s = useApp.getState();
      const id = s.createDocumentWindow("worksheet", t.dataset.id);
      s.focusWindow(id);
      s.setStageTab("plot");
      t.onStageOpen?.();
    },
  },
  { id: "dataset.duplicate", label: "Duplicate", run: (t) => void useApp.getState().duplicateDataset(t.dataset.id) },
  { id: "dataset.rename", label: "Rename…", run: (t) => t.onRename() },
  { id: "dataset.addTag", label: "Add tag…", run: (t) => t.onAddTag() },
  {
    id: "dataset.showInFolder",
    label: "Show in folder",
    hidden: (t) => t.dataset.folderId == null,
    run: (t) => useApp.getState().requestReveal(t.dataset.id),
  },
  {
    id: "dataset.reimport",
    label: (t) => (t.dataset.source ? "Re-import from source" : "Re-import from file…"),
    run: (t) => void useApp.getState().reimportDataset(t.dataset.id),
  },
  {
    id: "dataset.split",
    label: "Split by column value…",
    run: (t) => useApp.getState().openSplitDialog(t.dataset.id),
  },
];

/** Appended right after the dynamic per-folder move list. */
export const datasetNewFolderAction: ContextAction<DatasetActionTarget> = {
  id: "dataset.newFolderWithThis",
  label: "New folder with this…",
  run: (t) => {
    const s = useApp.getState();
    s.moveDatasetToFolder(t.dataset.id, s.createFolder(null, "New Folder"));
  },
};

export const datasetCorrectionsActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.applyCorrectionsAll",
    label: "Apply corrections to all",
    hidden: (t) => !t.dataset.corrections,
    run: (t) => {
      const s = useApp.getState();
      void s.applyCorrectionsToMany(
        t.dataset.id,
        s.datasets.map((x) => x.id),
      );
    },
  },
  {
    id: "dataset.applyCorrectionsSelected",
    label: (t) => `Apply corrections to ${t.selectedIds.length} selected`,
    hidden: (t) => !t.dataset.corrections || !multiSelected(t),
    run: (t) => void useApp.getState().applyCorrectionsToMany(t.dataset.id, [...t.selectedIds]),
  },
];

export const datasetMultiSelectActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.mergeSelected",
    label: (t) => `Merge ${t.selectedIds.length} selected`,
    hidden: (t) => !multiSelected(t),
    run: (t) => {
      void useApp.getState().mergeSelected();
      t.onStageOpen?.();
    },
  },
  ...(
    [
      ["panelRow", "Panel: side by side", "row"],
      ["panelColumn", "Panel: stacked", "column"],
      ["panelGrid", "Panel: grid", "grid"],
      ["overlay", "Overlay in one plot", "overlay"],
    ] as const
  ).map(
    ([key, label, layout]): ContextAction<DatasetActionTarget> => ({
      id: `dataset.${key}`,
      label,
      hidden: (t) => !multiSelected(t),
      run: (t) => {
        const s = useApp.getState();
        s.focusWindow(s.createPanelWindow([...t.selectedIds], layout));
        t.onStageOpen?.();
      },
    }),
  ),
  // PLOT_WORKFLOW_PLAN #3: distinct from "Overlay in one plot" above (a
  // composite panel window keeping each dataset separate) — this MERGES the
  // selection into one real Library dataset via the same gate+build+land
  // sequence the Plot-menu/palette command uses (lib/plotSelectedTogether),
  // so the row menu and the menu bar can never drift apart.
  {
    id: "dataset.plotSelectedTogether",
    label: "Plot selected together",
    hidden: (t) => !multiSelected(t),
    run: (t) => {
      void plotSelectedTogether(t.selectedIds);
      t.onStageOpen?.();
    },
  },
];

export const datasetMoveActions: ContextAction<DatasetActionTarget>[] = [
  { id: "dataset.moveUp", label: "Move up", enabled: (t) => t.canMoveUp, run: (t) => useApp.getState().moveDataset(t.dataset.id, -1) },
  {
    id: "dataset.moveDown",
    label: "Move down",
    enabled: (t) => t.canMoveDown,
    run: (t) => useApp.getState().moveDataset(t.dataset.id, 1),
  },
];

// Moved to lib/datasetRemoveActions.ts (funds the .ts 500-line ceiling — see
// that file's header); re-exported so the row menu takes the whole registry
// from one module.
import { datasetRemoveActions } from "./datasetRemoveActions";
export { datasetRemoveActions } from "./datasetRemoveActions";

/** Every dataset action, flat — for callers that don't care about layout. */
export const datasetActions: ContextAction<DatasetActionTarget>[] = [
  ...datasetCoreActions,
  datasetNewFolderAction,
  ...datasetCorrectionsActions,
  ...datasetMultiSelectActions,
  ...datasetMoveActions,
  ...datasetRemoveActions,
];
