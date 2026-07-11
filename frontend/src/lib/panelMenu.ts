// The Library row's multi-selection context-menu items: merge (#19 legacy)
// plus the panel/overlay composite-window quick picks (MAIN_PLAN #19 v1),
// shown only when >=2 rows are selected. Extracted out of DatasetRow.tsx's
// inline `menuItems` build into one pure builder so the row component keeps
// headroom under its component-ceiling ratchet (architecture.test.ts) — the
// row was already sitting exactly at 400 lines before this feature.

import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import type { PanelLayout } from "./plotview";

export interface MultiSelectMenuActions {
  mergeSelected: () => void;
  createPanelWindow: (ids: string[], layout: PanelLayout) => string;
  focusWindow: (id: string) => void;
}

const PANEL_PICKS: readonly [PanelLayout, string][] = [
  ["row", "Panel: side by side"],
  ["column", "Panel: stacked"],
  ["grid", "Panel: grid"],
  ["overlay", "Overlay in one plot"],
];

/** The multi-selection menu items: "Merge N selected" + the 4 panel/overlay
 *  quick picks — empty (no separator, nothing) below 2 selected rows, so a
 *  caller can splice the result straight into its own item list. `selectedIds`
 *  is the LIVE multi-selection (not just this row's id); each quick pick opens
 *  ONE new composite window over the whole selection and focuses it — a fresh
 *  window always starts focused here, unlike `createWindow`'s bare action
 *  (which leaves focusing to its caller too — this IS that caller). */
export function multiSelectMenuItems(
  selected: boolean,
  selectedCount: number,
  selectedIds: readonly string[],
  actions: MultiSelectMenuActions,
): ContextMenuItem[] {
  if (!selected || selectedCount <= 1) return [];
  return [
    { separator: true },
    { label: `Merge ${selectedCount} selected`, run: actions.mergeSelected },
    ...PANEL_PICKS.map(
      ([layout, label]): ContextMenuItem => ({
        label,
        run: () => actions.focusWindow(actions.createPanelWindow([...selectedIds], layout)),
      }),
    ),
  ];
}
