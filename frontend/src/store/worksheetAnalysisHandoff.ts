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
