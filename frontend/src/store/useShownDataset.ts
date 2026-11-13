// The dataset the STAGE is showing, for the chrome that names it (title bar,
// status bar). Usually the active one -- but on the Worksheet tab, a plain
// click on an Origin book opens it as a worksheet WITHOUT changing the active
// (plotted) dataset (`activateFromLibrary`, store/datasetSelection.ts: Origin's
// own model, opening a workbook never touches your graphs). The Worksheet tab
// then shows `worksheetId`'s data (components/Stage/Worksheet.tsx), and a
// title/status bar still naming the active dataset described a sheet that was
// not on screen.

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

export function useShownDataset(): Dataset | null {
  return useApp((s) => s.datasets.find((d) => d.id === ((s.stageTab === "worksheet" && s.worksheetId) || s.activeId)) ?? null);
}
