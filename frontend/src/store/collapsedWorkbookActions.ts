// Store actions for a single-sheet workbook shown as ONE Library row
// (lib/libraryHierarchy's collapsedSheetOf; menu pieces are in
// components/Library/collapsedWorkbook.ts): the row acts as the WORKBOOK for
// rename and move, so these touch both the workbook and its sheet.
//
// Rename and move live in store/collapsedWorkbookMoves.ts (bundle diet slice
// 32): only the lazy Library row, workshops and menus call them, so the entry
// chunk keeps just the remove half, which the eager dataset-removal helpers use.

import { PROTECTED_NOTICE, protectedAmong } from "../lib/sheetProtection";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

export * from "./collapsedWorkbookMoves";

/** Remove `ids` as the Library does for collapsed single-sheet rows: a row
 *  whose workbook holds ONLY that sheet stands for the workbook, so removing
 *  it deletes the workbook too (`deleteWorkbook`: members to Trash, its scoped
 *  Quick Plot templates pruned) instead of stranding a memberless ghost. Every
 *  other id takes the plain `removeDatasets` path, whose semantics are
 *  unchanged (a workbook that loses its last sheet that way stays alive). One
 *  Undo step restores everything. */
export function removeDatasetsPruningCollapsed(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const get = useApp.getState;
  const s = get();
  const locked = protectedAmong(s.datasets, ids); // refuse the whole removal, not half of it
  if (locked) return s.setStatus(`${locked.name}: ${PROTECTED_NOTICE}`);
  const drop = new Set(ids);
  const collapsed = new Set<string>();
  for (const w of s.workbooks) {
    if (w.originBook) continue;
    const members = s.datasets.filter((d) => d.workbookId === w.id);
    if (members.length === 1 && drop.has(members[0].id)) collapsed.add(w.id);
  }
  if (collapsed.size === 0) {
    s.removeDatasets([...ids]);
    return;
  }
  asOneEditStep(get, "remove datasets", () => {
    const gone = new Set<string>();
    for (const wid of collapsed) {
      const sheet = get().datasets.find((d) => d.workbookId === wid);
      get().deleteWorkbook(wid);
      if (!get().workbooks.some((w) => w.id === wid) && sheet) gone.add(sheet.id);
    }
    const rest = ids.filter((id) => !gone.has(id));
    if (rest.length > 0) get().removeDatasets(rest);
  });
}
