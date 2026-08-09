// Per-panel context-menu items + primary (double-click/Enter) action for the
// Figure Page composer's slot grid (FIGURE_AUTHORING_WORKFLOW_PLAN F3.4:
// "unify panel editing" — double-click or context-menu a panel to edit,
// promote, or duplicate the figure it references, instead of only being able
// to assign/clear it). Pure: takes a slot + its live status (lib/figurepage's
// `resolvePanelSource` output, already computed by useFigurePage) plus a
// small bag of callbacks and returns the `ContextMenuItem[]` SlotGrid renders
// through the shared `<ContextMenu/>` (components/overlays/ContextMenu.tsx —
// the same keyboard-complete popup every other retrofitted right-click menu
// in the app uses).
//
// F3.4 unification decision (see the plan's dated log for the full
// rationale): the three-kind session-source model (window/figdoc/figure)
// STAYS — collapsing pickable sources down to "canonical figures only" would
// drop a currently-working capability F3.1's own log explicitly warned
// against, and nothing about EDITING a panel requires removing it. What
// unifies here is the EDITING interaction itself: every panel kind now gets
// exactly ONE double-click/context-menu entry point (never a silent no-op),
// and every kind's menu steers toward acquiring — or, for a "figure" kind,
// already having — a durable canonical identity. A "window" panel's menu
// additionally offers "Save as editable figure" so a user can resolve F3.3's
// unresolved-slot Save block from the panel itself, without hunting for the
// window's own title-bar Save button.

import type { PageSlot, PanelSourceStatus } from "../../../lib/figurepage";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

export interface PanelMenuActions {
  /** figure: open the editable figure for editing; window: focus/restore its
   *  window. Not called for figdoc (use `onPromote`) or a missing source. */
  onEdit: () => void;
  /** window only: save the window's current document into `editableFigures`
   *  (the SAME action its title-bar Save button runs) without opening/
   *  focusing anything. */
  onSaveAsFigure: () => void;
  /** figdoc only: create an editable copy and repoint this slot at it. */
  onPromote: () => void;
  /** figure only: duplicate the referenced figure and repoint this slot at
   *  the copy ("duplicate for this page" / unlink). */
  onDuplicateForPage: () => void;
  onClear: () => void;
}

/** The double-click / Enter primary action for a slot, or null when there is
 *  nothing to do. An empty slot has no source to act on; a "missing" one has
 *  nothing left at the far end of its dangling reference to open/promote —
 *  "never a dead end" for THAT case means Clear stays reachable (via the
 *  menu and the existing × chip), not that an edit target is invented. */
export function primaryPanelAction(
  slot: PageSlot,
  status: PanelSourceStatus,
  actions: PanelMenuActions,
): (() => void) | null {
  if (!slot.source || status.status === "missing") return null;
  if (slot.source.kind === "figure" || slot.source.kind === "window") return actions.onEdit;
  return actions.onPromote; // figdoc
}

/** The full context-menu item list for a slot. Empty for an unassigned slot
 *  (nothing to act on beyond the existing drag/click-to-assign affordances —
 *  SlotGrid skips opening a menu entirely when this returns []). A missing
 *  slot offers ONLY Clear: its source no longer resolves to anything a
 *  figure/window/promotion action could act on. */
export function buildPanelMenuItems(
  slot: PageSlot,
  status: PanelSourceStatus,
  actions: PanelMenuActions,
): ContextMenuItem[] {
  if (!slot.source) return [];
  if (status.status === "missing") {
    return [{ label: "Clear panel", run: actions.onClear, danger: true }];
  }
  const items: ContextMenuItem[] = [];
  if (slot.source.kind === "figure") {
    items.push({ label: "Edit figure", run: actions.onEdit });
    items.push({ label: "Duplicate for this page", run: actions.onDuplicateForPage });
  } else if (slot.source.kind === "window") {
    items.push({ label: "Focus window", run: actions.onEdit });
    items.push({ label: "Save as editable figure", run: actions.onSaveAsFigure });
  } else {
    items.push({ label: "Create editable copy", run: actions.onPromote });
  }
  items.push({ separator: true });
  items.push({ label: "Clear panel", run: actions.onClear, danger: true });
  return items;
}
