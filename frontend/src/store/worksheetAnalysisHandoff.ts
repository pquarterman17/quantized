import { contiguousRowRange, rowRangeLabel } from "../lib/rowRange";
import { seedDesignatedErrorZones } from "../lib/plotspecDesignatedErrors";
import { selectionToSpec } from "../lib/selectionplot";
import type { DataStruct } from "../lib/types";
import { seedWorksheetAnalysisSelection } from "./analysisSelection";
import { useApp } from "./useApp";

export function openWorksheetGraphBuilder(data: DataStruct, datasetId: string, columns: readonly number[]): boolean {
  const spec = selectionToSpec(data, datasetId, columns);
  if (!spec) return false;
  // The selected Ys carry their bound error columns (Y-error designations).
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  useApp.getState().openGraphBuilderSeeded(ds ? seedDesignatedErrorZones(spec, ds) : spec);
  return true;
}

/** Worksheet gesture -> shared analysis contract -> Analysis Center. */
export function openWorksheetAnalysisSelection(
  datasetId: string,
  columns: readonly number[],
  rows: readonly number[],
): void {
  if (!seedWorksheetAnalysisSelection(datasetId, columns, rows)) return;
  const app = useApp.getState();
  if (app.activeId !== datasetId) app.setActive(datasetId);
  useApp.getState().setStageTab("analysis");
}

/** Worksheet "Use as row range": the selected rows, which must be one
 *  contiguous block, become the analysis input's row window and open the
 *  Analysis Center on it. The columns are chosen there; nothing is persisted. */
export function openWorksheetRowRange(datasetId: string, rows: Iterable<number>): void {
  const block = contiguousRowRange(rows);
  const app = useApp.getState();
  if ("reason" in block) return app.setStatus(`Can't use as a row range: ${block.reason}`);
  if (!seedWorksheetAnalysisSelection(datasetId, [], [], block.range)) return;
  if (app.activeId !== datasetId) app.setActive(datasetId);
  useApp.getState().setStageTab("analysis");
  useApp.getState().setStatus(`${rowRangeLabel(block.range)} set as the analysis row range — choose the columns in the Analysis Center`);
}
