// The ONE "open this dataset as a worksheet" intent (SCIENTIFIC_WORKBENCH
// plan, "Worksheet actions strand users in dockable layout"). New Workbook,
// Open as worksheet, Go to Source, a Library search hit and a classic View >
// Worksheet request all end here, carrying a dataset id and optional row ids.
//
// It is an EXPLICIT open, not a selection: it never calls `setActive`, so the
// focused plot and every tool that follows the active dataset (Fit Y by X, ...)
// keep their input. Passive selection (a Library click) is a different intent
// and is untouched.
// - classic layout: the Worksheet tab shows it through the `worksheetId`
//   override (store/datasetSelection.ts), the same path an Origin book click
//   takes;
// - window layout: the layout host registers a handler that opens (or raises)
//   a worksheet DOCUMENT window for the dataset, see
//   components/workshops/windowlayout/openWorksheetWindow.ts.

import { useApp } from "./useApp";

export interface WorksheetOpenIntent {
  datasetId: string;
  /** Rows to select in the opened sheet. */
  rowIds?: readonly number[];
}

/** The Worksheet tab's own selection key when it shows a non-active dataset
 *  (components/Stage/worksheet/useWorksheetView.ts). */
export const STAGE_WORKSHEET_SELECTION_KEY = "stage-worksheet";

let windowHandler: ((intent: WorksheetOpenIntent) => void) | null = null;

/** The window-layout host's handler while it is mounted; returns the cleanup. */
export function setWorksheetWindowHandler(handler: (intent: WorksheetOpenIntent) => void): () => void {
  windowHandler = handler;
  return () => {
    if (windowHandler === handler) windowHandler = null;
  };
}

/** Is the window-layout host answering worksheet opens (windows mode on screen)? */
export const worksheetWindowsActive = (): boolean => windowHandler !== null;

/** The worksheet window `openWorksheet` just opened or raised for `datasetId`
 *  in the window layout; undefined in classic, where the Stage tab shows it. A
 *  reveal request (store/worksheetReveal.ts) names it as its `windowId`. */
export function openedWorksheetWindowId(datasetId: string): string | undefined {
  if (!windowHandler) return undefined;
  return useApp.getState().plotWindows.find((w) => w.kind === "worksheet" && w.datasetId === datasetId)?.id;
}

export function openWorksheet(intent: WorksheetOpenIntent): void {
  const s = useApp.getState();
  const { datasetId, rowIds } = intent;
  if (!s.datasets.some((d) => d.id === datasetId)) return;
  if (windowHandler) return windowHandler(intent);
  useApp.setState({ worksheetId: datasetId, stageTab: "worksheet" });
  s.ensureBookData(datasetId);
  if (!rowIds?.length) return;
  if (datasetId === s.activeId) s.setRowSelection([...rowIds]);
  else s.setWorksheetRowSelection(STAGE_WORKSHEET_SELECTION_KEY, datasetId, [...rowIds]);
}
