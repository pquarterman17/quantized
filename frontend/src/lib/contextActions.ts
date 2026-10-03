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
import type { Dataset } from "./types";

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

export function resolveLabel<T>(a: ContextAction<T>, t: T): string {
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

// The dataset registry itself (`datasetCoreActions` … `datasetActions`) lives
// in lib/datasetContextActions.ts and the palette bridge's
// `actionPaletteEntry` in lib/paletteContextActions.ts (bundle diet slice 22,
// plans/BUNDLE_HEADROOM.md): their only consumers are the dataset row menu
// and the ⌘K palette's context entries, both already lazy, so they load with
// them. Import them by path; this module does not re-export them.
//
// The folder registry lives in components/Library/folderRowMenu.ts and
// the plot-curve registry in lib/curveContextActions.ts (bundle diet slice
// 12, plans/BUNDLE_HEADROOM.md): their only consumers are the folder row
// menu / Library tree and the plot-canvas menu, all already lazy, so they
// load in the same chunk as the menu that shows them — no right-click waits
// longer. This module (the engine and the target types) stays eager.

export { multiSelected };
