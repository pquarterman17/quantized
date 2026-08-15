// Pure roving-focus arithmetic for the Library tree container
// (LIBRARY_WORKBOOK_UX_PLAN PR C). Operates only on the flattened row array
// + an index — no DOM, no store — so the traversal rules (mirrors
// lib/menuKeyboardNav.ts's split for ContextMenu) are unit-testable without
// rendering anything. LibraryTree.tsx is the DOM glue: it resolves "which
// row currently has focus" to an index, calls `navigate`, then either moves
// real focus (`focusIndex`) or toggles expansion (`toggleIndex`).

import type { FlatLibraryNode } from "./libraryHierarchy";

export type NavDirection = "down" | "up" | "right" | "left";

export interface NavResult {
  /** Row index to move DOM focus to, or null when the gesture doesn't move focus. */
  focusIndex: number | null;
  /** A folder/workbook row index to toggle expansion for (Right on a
   *  collapsed parent; Left on an expanded one), or null. */
  toggleIndex: number | null;
}

const NONE: NavResult = { focusIndex: null, toggleIndex: null };

/**
 * One keyboard gesture from `index` over the flattened, already-expansion-
 * aware `rows` array:
 *   - down/up: the adjacent row, or a no-op past either end.
 *   - right: expand a collapsed parent in place, or move into its first
 *     child (the flattened list already puts it immediately after once
 *     expanded) — a no-op on a leaf or an already-expanded row with no
 *     visible children yet (the caller re-renders with the child rows
 *     inserted before this fires again).
 *   - left: collapse an expanded parent in place, or move up to the row's
 *     own parent (found by matching `parentKey`) — a no-op at the root with
 *     nothing expanded.
 */
export function navigate(rows: readonly FlatLibraryNode[], index: number, direction: NavDirection): NavResult {
  if (index < 0 || index >= rows.length) return NONE;
  const row = rows[index];
  switch (direction) {
    case "down":
      return index + 1 < rows.length ? { focusIndex: index + 1, toggleIndex: null } : NONE;
    case "up":
      return index - 1 >= 0 ? { focusIndex: index - 1, toggleIndex: null } : NONE;
    case "right":
      if (!row.hasChildren) return NONE;
      if (!row.expanded) return { focusIndex: null, toggleIndex: index };
      return index + 1 < rows.length ? { focusIndex: index + 1, toggleIndex: null } : NONE;
    case "left": {
      if (row.hasChildren && row.expanded) return { focusIndex: null, toggleIndex: index };
      if (!row.node.parentKey) return NONE;
      const parentIndex = rows.findIndex((r) => r.node.key === row.node.parentKey);
      return parentIndex >= 0 ? { focusIndex: parentIndex, toggleIndex: null } : NONE;
    }
  }
}

/** Locate a row by its canonical key — used after `rows` changes (an item
 *  was removed/moved) to find where the previously-focused row landed, or
 *  that it's gone. */
export function indexOfKey(rows: readonly FlatLibraryNode[], key: string | null): number {
  if (!key) return -1;
  return rows.findIndex((r) => r.node.key === key);
}
