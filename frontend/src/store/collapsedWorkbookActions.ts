// Store actions for a single-sheet workbook shown as ONE Library row
// (lib/libraryHierarchy's collapsedSheetOf; menu pieces are in
// components/Library/collapsedWorkbook.ts): the row acts as the WORKBOOK for
// rename and move, so these touch both the workbook and its sheet.

import { useApp } from "./useApp";

/** Rename the workbook AND its sheet together -- they share one name, and the
 *  row shows the sheet's. renameDataset records the single undo step (its
 *  snapshot includes `workbooks`), so the workbook follows without a second
 *  entry and one Undo restores both. A refused sheet rename (a name sheet()
 *  links cannot show) leaves the workbook alone too. */
export function renameCollapsedWorkbook(datasetId: string, workbookId: string, name: string): void {
  const s = useApp.getState();
  const before = s.datasets.find((d) => d.id === datasetId)?.name;
  s.renameDataset(datasetId, name);
  const after = useApp.getState().datasets.find((d) => d.id === datasetId)?.name;
  if (!after) return;
  const wb = useApp.getState().workbooks.find((w) => w.id === workbookId);
  if (!wb || wb.name === after) return;
  if (after === before) useApp.getState().renameWorkbook(workbookId, after); // sheet already had the name: only the workbook differed
  else useApp.setState((st) => ({ workbooks: st.workbooks.map((w) => (w.id === workbookId ? { ...w, name: after } : w)) }));
}

/** Move the rows' WORKBOOKS (not the sheets) into `folderId`; a dataset with no
 *  workbook falls back to the plain dataset move. */
export function moveToFolderViaWorkbooks(ids: readonly string[], folderId: string | null): void {
  const s = useApp.getState();
  const workbookIds = new Set<string>();
  const loose: string[] = [];
  for (const id of ids) {
    const wb = s.datasets.find((d) => d.id === id)?.workbookId;
    if (wb && s.workbooks.some((w) => w.id === wb)) workbookIds.add(wb);
    else loose.push(id);
  }
  workbookIds.forEach((id) => s.moveWorkbookToFolder(id, folderId));
  if (loose.length > 0) s.moveDatasetsToFolder(loose, folderId);
}
