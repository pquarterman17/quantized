// Store actions for a single-sheet workbook shown as ONE Library row
// (lib/libraryHierarchy's collapsedSheetOf; menu pieces are in
// components/Library/collapsedWorkbook.ts): the row acts as the WORKBOOK for
// rename and move, so these touch both the workbook and its sheet.

import { toast } from "./toasts";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

/** Rename the workbook AND its sheet together -- they share one name, and the
 *  row shows the sheet's. renameDataset records the single undo step (its
 *  snapshot includes `workbooks`), so the workbook follows without a second
 *  entry and one Undo restores both. A refused sheet rename (a name sheet()
 *  links cannot show) leaves the workbook alone too. */
export function renameCollapsedWorkbook(datasetId: string, workbookId: string, name: string): void {
  const wanted = name.trim();
  const s = useApp.getState();
  const before = s.datasets.find((d) => d.id === datasetId)?.name;
  if (!wanted || before === undefined) return;
  s.renameDataset(datasetId, wanted);
  const after = useApp.getState().datasets.find((d) => d.id === datasetId)?.name;
  if (after !== wanted) return; // refused (or vanished): nothing changed, nothing more to record
  const wb = useApp.getState().workbooks.find((w) => w.id === workbookId);
  if (!wb || wb.name === wanted) return;
  if (before === wanted) useApp.getState().renameWorkbook(workbookId, wanted); // sheet already had the name: only the workbook differed
  else useApp.setState((st) => ({ workbooks: st.workbooks.map((w) => (w.id === workbookId ? { ...w, name: wanted } : w)) }));
}

/** Move the WORKBOOK of every selected COLLAPSED row (a workbook holding only
 *  that sheet) into `folderId`; a dataset with no workbook falls back to the
 *  plain dataset move. A sheet of a MULTI-sheet workbook cannot move alone (its
 *  placement follows its workbook) and moving the workbook would drag its
 *  unselected siblings along, so it is left out. Returns how many were left. */
export function moveToFolderViaWorkbooks(ids: readonly string[], folderId: string | null): number {
  const s = useApp.getState();
  const workbookIds = new Set<string>();
  const loose: string[] = [];
  let stays = 0;
  for (const id of ids) {
    const wb = s.datasets.find((d) => d.id === id)?.workbookId;
    if (wb && s.workbooks.some((w) => w.id === wb)) {
      if (s.datasets.some((d) => d.workbookId === wb && !ids.includes(d.id))) stays++;
      else workbookIds.add(wb);
    } else loose.push(id);
  }
  workbookIds.forEach((id) => s.moveWorkbookToFolder(id, folderId));
  if (loose.length > 0) s.moveDatasetsToFolder(loose, folderId);
  if (stays > 0) toast(`${stays} sheet${stays > 1 ? "s" : ""} stay${stays > 1 ? "" : "s"} with ${stays > 1 ? "their workbooks" : "its workbook"}`, "info");
  return stays;
}

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
