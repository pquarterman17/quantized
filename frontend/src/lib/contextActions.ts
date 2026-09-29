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

import { multiSelected } from "./multiSelected";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { plotInNewWindow } from "./plotInNewWindow";
import { plotSelectedTogether } from "./plotSelectedTogether";
import type { Dataset } from "./types";
import type { Action as PaletteAction } from "../store/commands";
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
  /** L0.36: "disable unavailable commands with a short reason rather than
   *  removing them unpredictably" — shown as the disabled item's tooltip.
   *  Only consulted when `enabled` returns false. */
  disabledReason?: (t: T) => string;
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
  const disabled = a.enabled ? !a.enabled(t) : false;
  return {
    label: resolveLabel(a, t),
    run: () => runContextAction(a, t),
    disabled,
    title: disabled ? a.disabledReason?.(t) : undefined,
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
  /** Tile workspace only (undefined in the tree): return to the Stage after
   *  an action whose visible result is a plot (plot, plotInNewWindow,
   *  panels, merge, plot-together) — the PR #145 stage-return decision. MUST
   *  only close/reveal, never re-open: the action already performed its open,
   *  and a re-open detours Origin books via activateFromLibrary's tab path. */
  onStageOpen?: () => void;
}


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
// that file's header); re-exported so every existing `from "./contextActions"`
// importer is untouched.
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

// The folder registry lives in components/Library/folderRowMenu.ts and
// the plot-curve registry in lib/curveContextActions.ts (bundle diet slice
// 12, plans/BUNDLE_HEADROOM.md): their only consumers are the folder row
// menu / Library tree and the plot-canvas menu, all already lazy, so they
// load in the same chunk as the menu that shows them — no right-click waits
// longer. This module (the engine and the dataset registry the ⌘K palette
// reads) stays eager.

export { multiSelected };
