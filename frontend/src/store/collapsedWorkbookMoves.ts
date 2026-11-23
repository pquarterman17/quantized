// The rename and move halves of store/collapsedWorkbookActions.ts (bundle diet
// slice 32), re-exported from it with `export *` so no importer changed. Only
// the lazy Library row, the workshops and the Library menus call them.

import { toast } from "./toasts";
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
