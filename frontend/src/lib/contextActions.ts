// GUI_INTERACTION #8: a context-action REGISTRY keyed by object type. Each
// entry is a declarative {id,label,run,...} definition; a menu builder walks
// the array for its object type via `buildMenuItems` instead of hand-rolling
// a `ContextMenuItem[]` inline — so an action is defined exactly once and
// every right-click menu offering it renders the identical label/gating.
// (Consumers today: the retrofitted right-click menus — dataset row, folder
// row, plot curve, worksheet column/row, window title bar, annotation/shape
// objects — plus the ⌘K palette (`lib/paletteContextActions` via
// `actionPaletteEntry`) and the selection mini-toolbar
// (`Stage/SelectionMiniToolbar`). The Plot Objects tree (#2) stays gated.)
//
// `run()` calls the store (`useApp.getState()`) or the existing `folderOps`
// helpers DIRECTLY, unlike the older ad-hoc builders that threaded a bag of
// callback props one field at a time — a registry action only needs its
// TARGET (the domain object, plus the couple of local-UI hooks the owning
// row supplies, e.g. "open my own inline rename input") to act. That is what
// lets the same entry run from a mouse right-click, a keyboard-opened menu,
// or the new "⋯" resting-cue button without three different prop shapes.
//
// Destructive entries (`destructive: true`) route through the existing
// `askConfirm` (ConfirmDialog) before `run` fires — the plan's "confirm-first
// is the policy for now" (undo itself is still owner-gated, GUI_INTERACTION
// #1).

import {
  applyActiveCorrectionsToFolder,
  exportFolderCsv,
  openFolderProperties,
  removeFolderWithDatasets,
  runTemplateOnFolder,
  selectFolderContents,
} from "../components/Library/folderOps";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import type { PlotMenuContext, MenuSeries } from "./plotMenu";
import { loadTemplates } from "./template";
import type { Dataset, FolderNode } from "./types";
import type { Action as PaletteAction } from "../store/commands";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

// ── generic engine ──────────────────────────────────────────────────────

export interface ConfirmSpec {
  title: string;
  message?: string;
  confirmLabel?: string;
}

export interface ContextAction<T> {
  id: string;
  label: string | ((t: T) => string);
  glyph?: string;
  group?: string;
  /** Gates enabled/disabled — the item still SHOWS, greyed + inert. */
  enabled?: (t: T) => boolean;
  /** Omits the item entirely (vs. merely disabling it) — e.g. "Show in
   *  folder" for a root-level dataset, where a disabled entry would just be
   *  confusing rather than informative. */
  hidden?: (t: T) => boolean;
  /** Data-destroying / hard-to-reverse — routes through `askConfirm` first. */
  destructive?: boolean;
  /** Renders red like `destructive` but WITHOUT the confirm step — for
   *  deleting cheap-to-recreate canvas objects (annotation/shape), where a
   *  confirm dialog would cost more than the object (undo is the eventual
   *  answer there — owner-gated #1). */
  danger?: boolean;
  /** Checkmark state for toggle actions (menu renders ✓). */
  checked?: (t: T) => boolean;
  confirm?: (t: T) => ConfirmSpec;
  run: (t: T) => void;
}

/** A registry array may mix real actions with raw separators so a caller can
 *  compose a registry block straight into a hand-built item list. */
export type MenuEntry<T> = ContextAction<T> | { separator: true };

function resolveLabel<T>(a: ContextAction<T>, t: T): string {
  return typeof a.label === "function" ? a.label(t) : a.label;
}

/** Run one action against its target — destructive actions confirm first. */
export function runContextAction<T>(a: ContextAction<T>, t: T): void {
  if (a.destructive) {
    const c = a.confirm?.(t) ?? { title: `${resolveLabel(a, t)}?` };
    void askConfirm(c.title, c.message ?? "", c.confirmLabel ?? "Remove", true).then((ok) => {
      if (ok) a.run(t);
    });
    return;
  }
  a.run(t);
}

/** One registry action → one `ContextMenuItem`, or null when `hidden` gates
 *  it out (callers filter via `buildMenuItems`, which never emits nulls). */
export function actionMenuItem<T>(a: ContextAction<T>, t: T): ContextMenuItem | null {
  if (a.hidden?.(t)) return null;
  return {
    label: resolveLabel(a, t),
    run: () => runContextAction(a, t),
    disabled: a.enabled ? !a.enabled(t) : false,
    danger: a.destructive || a.danger || undefined,
    checked: a.checked ? a.checked(t) : undefined,
  };
}

/** One registry action → one ⌘K palette `Action`, or null when the entry
 *  doesn't apply: hidden/disabled entries are OMITTED (the palette has no
 *  greyed rows — a command you can't run shouldn't be findable). The same
 *  `runContextAction` routing means destructive entries keep their confirm
 *  step when launched from the palette. */
export function actionPaletteEntry<T>(
  a: ContextAction<T>,
  t: T,
  group: string,
  idPrefix: string,
): PaletteAction | null {
  if (a.hidden?.(t)) return null;
  if (a.enabled && !a.enabled(t)) return null;
  return {
    id: `${idPrefix}.${a.id}`,
    group,
    label: resolveLabel(a, t),
    run: () => runContextAction(a, t),
  };
}

/** Build a full item list from a registry block against one target. */
export function buildMenuItems<T>(entries: MenuEntry<T>[], t: T): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const e of entries) {
    if ("separator" in e) {
      out.push(e);
      continue;
    }
    const item = actionMenuItem(e, t);
    if (item) out.push(item);
  }
  return out;
}

/** True for "open the context menu from the keyboard": the dedicated
 *  ContextMenu key, or the cross-platform Shift+F10 fallback. Shared by
 *  every retrofitted object row so "right-click, or focus + this key" stays
 *  one rule instead of being reinvented per row. */
export function isContextMenuKeyEvent(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

// ── dataset registry ────────────────────────────────────────────────────

export interface DatasetActionTarget {
  dataset: Dataset;
  active: boolean;
  selected: boolean;
  selectedIds: readonly string[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Local UI: open this row's own inline rename/tag input. */
  onRename: () => void;
  onAddTag: () => void;
}

const multiSelected = (t: DatasetActionTarget) => t.selected && t.selectedIds.length > 1;

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
    run: (t) => useApp.getState().setActive(t.dataset.id),
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
    run: () => useApp.getState().mergeSelected(),
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
      },
    }),
  ),
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

export const datasetRemoveActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.remove",
    label: "Remove",
    destructive: true,
    confirm: (t) => ({ title: `Remove "${t.dataset.name}"?`, confirmLabel: "Remove" }),
    run: (t) => {
      useApp.getState().removeDataset(t.dataset.id);
      toast(`removed ${t.dataset.name}`);
    },
  },
  {
    id: "dataset.removeSelected",
    label: (t) => `Remove ${t.selectedIds.length} selected`,
    hidden: (t) => !multiSelected(t),
    destructive: true,
    confirm: (t) => ({ title: `Remove ${t.selectedIds.length} datasets?`, confirmLabel: "Remove" }),
    run: (t) => {
      const n = t.selectedIds.length;
      useApp.getState().removeSelected();
      toast(`removed ${n} datasets`);
    },
  },
];

/** Every dataset action, flat — for callers that don't care about layout. */
export const datasetActions: ContextAction<DatasetActionTarget>[] = [
  ...datasetCoreActions,
  datasetNewFolderAction,
  ...datasetCorrectionsActions,
  ...datasetMultiSelectActions,
  ...datasetMoveActions,
  ...datasetRemoveActions,
];

// ── folder registry ─────────────────────────────────────────────────────

export interface FolderActionTarget {
  folder: FolderNode;
  count: number;
  /** Local UI: open this row's own inline rename input / reveal a new child. */
  onRename: () => void;
  onExpand: () => void;
}

function activeDataset(): Dataset | undefined {
  const s = useApp.getState();
  return s.datasets.find((d) => d.id === s.activeId);
}

// GUI_INTERACTION #3 sub-item 4: split into named groups (mirroring the
// dataset registry's own `datasetCoreActions`/`datasetMoveActions`/…) so
// `folderRowMenu.ts` can splice the genuinely-dynamic per-folder "Move to …"
// list (one entry per LIVE folder, same reason the dataset one can't be a
// fixed registry entry) between the core and bulk-ops groups — the same
// slot the drag-onto-another-folder-header gesture's menu equivalent
// belongs in. `folderActions` below is still the flat concatenation (with
// separators) for a caller that wants "every folder action" without caring
// about layout.
export const folderCoreActions: ContextAction<FolderActionTarget>[] = [
  {
    id: "folder.newSubfolder",
    label: "New subfolder",
    run: (t) => {
      useApp.getState().createFolder(t.folder.id, "New Folder");
      t.onExpand();
    },
  },
  { id: "folder.rename", label: "Rename…", run: (t) => t.onRename() },
  { id: "folder.properties", label: "Properties…", run: (t) => void openFolderProperties(t.folder) },
];

// ── bulk ops over the whole subtree (project-organization plan item 8) ──
export const folderBulkActions: ContextAction<FolderActionTarget>[] = [
  {
    id: "folder.selectAll",
    label: (t) => `Select all in folder (${t.count})`,
    enabled: (t) => t.count > 0,
    run: (t) => selectFolderContents(t.folder),
  },
  {
    id: "folder.exportCsv",
    label: "Export folder as consolidated CSV",
    enabled: (t) => t.count > 0,
    run: (t) => void exportFolderCsv(t.folder),
  },
  {
    id: "folder.applyActiveCorrections",
    label: (t) => `Apply active corrections to folder (${t.count})`,
    hidden: (t) => t.count === 0 || !activeDataset()?.corrections,
    run: (t) => void applyActiveCorrectionsToFolder(t.folder),
  },
  {
    id: "folder.runTemplate",
    label: "Run analysis template on folder…",
    hidden: (t) => t.count === 0 || loadTemplates().length === 0,
    run: (t) => void runTemplateOnFolder(t.folder),
  },
];

export const folderDeleteActions: ContextAction<FolderActionTarget>[] = [
  {
    id: "folder.delete",
    label: "Delete folder",
    destructive: true,
    confirm: (t) => ({ title: `Delete folder "${t.folder.name}"?`, confirmLabel: "Delete" }),
    run: (t) => {
      useApp.getState().deleteFolder(t.folder.id); // reparent: contents move up, datasets survive
      toast(`deleted folder "${t.folder.name}"`);
    },
  },
  {
    id: "folder.deleteWithDatasets",
    label: (t) => `Delete folder + ${t.count} dataset(s)`,
    hidden: (t) => t.count === 0,
    destructive: true,
    confirm: (t) => ({
      title: `Delete "${t.folder.name}" and its ${t.count} dataset(s)?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
    }),
    run: (t) => removeFolderWithDatasets(t.folder),
  },
];

/** Every folder action, flat — for callers that don't care about layout. */
export const folderActions: MenuEntry<FolderActionTarget>[] = [
  ...folderCoreActions,
  { separator: true },
  ...folderBulkActions,
  { separator: true },
  ...folderDeleteActions,
];

// ── plot curve (series) registry ────────────────────────────────────────

export interface CurveActionTarget {
  series: MenuSeries;
  ctx: PlotMenuContext;
  /** Whether any style field on this series has been overridden — gates
   *  "Reset series style". */
  overridden: boolean;
}

export const curveActions: ContextAction<CurveActionTarget>[] = [
  {
    id: "curve.toggleHidden",
    label: (t) => (t.series.hidden ? "Show series" : "Hide series"),
    enabled: (t) => t.series.hidden || t.ctx.canHide,
    run: (t) => t.ctx.toggleHidden(t.series.channel),
  },
  { id: "curve.rename", label: "Rename…", run: (t) => t.ctx.rename(t.series.channel) },
  {
    id: "curve.toggleY2",
    label: (t) => (t.series.onY2 ? "Move to left Y axis" : "Move to right Y axis"),
    run: (t) => t.ctx.toggleY2(t.series.channel),
  },
  // GUI_INTERACTION #3 sub-item 4: the menu-path equivalent of the legend
  // row's own draw-order reorder (its up/down arrow buttons + its own
  // right-click menu) — now defined ONCE here so the plot-canvas right-click
  // (lib/plotMenu.ts's curve menu) offers the same reorder PlotLegend always
  // has, instead of it being legend-only.
  {
    id: "curve.moveEarlier",
    label: "Move earlier (draw under)",
    enabled: (t) => t.ctx.canMoveSeries(t.series.channel, -1),
    run: (t) => t.ctx.moveSeries(t.series.channel, -1),
  },
  {
    id: "curve.moveLater",
    label: "Move later (draw over)",
    enabled: (t) => t.ctx.canMoveSeries(t.series.channel, 1),
    run: (t) => t.ctx.moveSeries(t.series.channel, 1),
  },
  {
    id: "curve.resetStyle",
    label: "Reset series style",
    hidden: (t) => !t.overridden,
    run: (t) => t.ctx.resetStyle(t.series.channel),
  },
];
