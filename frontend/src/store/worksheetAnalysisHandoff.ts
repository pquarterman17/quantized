import { selectionToSpec } from "../lib/selectionplot";
import type { DataStruct } from "../lib/types";
import { seedWorksheetAnalysisSelection } from "./analysisSelection";
import { useApp } from "./useApp";

export function openWorksheetGraphBuilder(data: DataStruct, datasetId: string, columns: readonly number[]): boolean {
  const spec = selectionToSpec(data, datasetId, columns);
  if (!spec) return false;
  useApp.getState().openGraphBuilderSeeded(spec);
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
