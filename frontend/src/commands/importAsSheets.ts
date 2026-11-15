// "Import as sheets of one workbook…" — Origin's multi-file import into ONE
// book, a sheet per file (worksheet audit #20). Every file imports exactly as
// "Import data…" would (`importFiles`, same parsers, notes and guards); the
// datasets it created are then gathered into one new workbook named after the
// first file (`combineWorkbooks`, the Library's own Combine), and the
// per-file workbooks that leaves empty are removed. The worksheet then shows
// the sheet tabs (SheetTabs). Lazily imported after the file pick.

import type { StoreGet } from "../lib/exportActive";
import { useApp } from "../store/useApp";

/** Import `files`, then put every resulting worksheet into one workbook.
 *  Returns that workbook's id (null when fewer than two worksheets landed:
 *  a single import already has its own workbook). */
export async function runImportAsSheets(s: StoreGet, files: File[]): Promise<string | null> {
  if (files.length === 0) return null;
  // suppressFolderOffer: these files are about to be gathered into ONE
  // workbook below, so the standard "create folder?" batch suggestion
  // (store/importTargetFolder.ts's batchFolderOffer) is never relevant here —
  // worksheet audit follow-up.
  const ids = await s().importFiles(files, { suppressFolderOffer: true });
  if (ids.length < 2) return null;
  const idSet = new Set(ids);
  const emptied = new Set(
    s().datasets.flatMap((d) => (idSet.has(d.id) && d.workbookId ? [d.workbookId] : [])),
  );
  const name = files[0].name.replace(/\.[^.]+$/, "") || "Book1";
  const workbookId = s().combineWorkbooks({ workbookIds: [], worksheetIds: ids }, name);
  if (!workbookId) return null;
  useApp.setState((st) => ({
    workbooks: st.workbooks.filter((w) => !emptied.has(w.id) || st.datasets.some((d) => d.workbookId === w.id)),
    expandedWorkbookIds: [...new Set([...st.expandedWorkbookIds.filter((id) => !emptied.has(id)), workbookId])],
  }));
  s().setActive(ids[0]);
  const msg = `imported ${ids.length} sheets into workbook "${name}"`;
  s().setStatus(msg);
  return workbookId;
}
