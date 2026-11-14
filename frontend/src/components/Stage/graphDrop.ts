// Drag a dataset or a book from the Library onto a GRAPH (origin gap audit 3
// N1): its Y columns join the graph as linked curves. Shared by the focused
// stage (components/Stage/AxisDropZones.tsx, which also serves the lone
// maximized window that has no frame) and a framed window's plot body
// (components/windows/PlotWindowFrame.tsx). The work loads on drop.

import { DATASET_DND, WORKBOOK_DND } from "../Library/dnd";
import { onLoadFailure, runLazy } from "../../lib/runLazy";

/** Is this drag a Library dataset or book (what a graph drop adds)? */
export function isLibraryDrag(types: readonly string[]): boolean {
  return types.includes(DATASET_DND) || types.includes(WORKBOOK_DND);
}

/** Add what `dt` carries to the graph showing `targetId`. */
export function dropOntoGraph(targetId: string, dt: DataTransfer): void {
  const dropped = { book: dt.getData(WORKBOOK_DND), dataset: dt.getData(DATASET_DND) };
  if (!dropped.book && !dropped.dataset) return;
  void runLazy("Adding curves…", () => import("../../store/layerContentsApply")).then(
    (m) => m.addDroppedToGraph(targetId, dropped),
    onLoadFailure,
  );
}
