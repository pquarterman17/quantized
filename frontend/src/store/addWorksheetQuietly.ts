// Add a result worksheet WITHOUT making it the active one.
//
// `addDataset` is the import path: the new dataset becomes active, the focused
// plot rebinds to it and every on-plot result is cleared. That is wrong for a
// worksheet an analysis writes BESIDE its source while the user is still
// working on that source — the Curve Fit's result worksheet and its batch
// summary: the plot jumped to the new sheet, the fit curve was cleared and the
// Curve Fit panel re-targeted the sheet it had just written (its own result
// gone). Like Origin, the sheet lands in the Library and the graph stays put;
// one undo step removes it. (The same shape as a workbook paste,
// store/workbookTransferRun.ts: record history, then one `set`.)

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

export function addWorksheetQuietly(ds: Dataset, historyLabel: string): void {
  useApp.getState().recordHistory(historyLabel);
  useApp.setState((s) => ({ datasets: [...s.datasets, ds] }));
}
