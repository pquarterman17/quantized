// Does the open Data window already show `datasetId`? A bare "show the worksheet"
// request (a stage-tab `worksheet` request from View > Worksheet, Mirror column…,
// Set column values…) then raises the Data window instead of opening a second
// window ("sheetB.csv (2)") onto the same sheet (acceptance pass 5, C12). Reads the
// same inputs the Data window resolves its source from (components/.../DataWindow.tsx).

import { resolveDataSource } from "../lib/windowLayout/dataSource";
import { useApp } from "./useApp";

export function dataWindowShows(datasetId: string): boolean {
  const s = useApp.getState();
  const layout = s.windowLayout;
  if (layout?.placements.data?.open !== true) return false;
  const plotFocused = s.plotWindows.some((w) => w.id === s.focusedWindowId && w.kind === "plot");
  const src = resolveDataSource({
    data: layout.data ?? { pinned: null, follow: "plot" },
    datasets: s.datasets,
    plotDatasetId: plotFocused ? s.activeId : null,
    library: { worksheetId: s.worksheetId, selectedIds: s.selectedIds, activeId: s.activeId },
    chosen: null,
  });
  return src.kind === "dataset" && src.datasetId === datasetId;
}
