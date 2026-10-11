import { create } from "zustand";

import type { AnalysisSelection, AnalysisSelectionSource } from "../lib/analysisSelection";
import { captureAnalysisSelection, updateAnalysisSelectionItem } from "../lib/analysisSelection";
import { plotRangeSelection } from "../lib/plotRangeSelection";
import type { RoiSector } from "../lib/roi";
import { selectionToSpec } from "../lib/selectionplot";
import { channelModelingType, isCategorical } from "../lib/modeling";
import { errKeysFromBindings } from "../lib/errorRoles";
import { useApp } from "./useApp";

interface AnalysisSelectionState {
  toolId: string | null;
  selection: AnalysisSelection | null;
  setSelection: (toolId: string, selection: AnalysisSelection) => void;
  updateItem: (datasetId: string, patch: Parameters<typeof updateAnalysisSelectionItem>[2]) => void;
  clear: () => void;
}

export const useAnalysisSelection = create<AnalysisSelectionState>((set) => ({
  toolId: null,
  selection: null,
  setSelection: (toolId, selection) => set({ toolId, selection }),
  updateItem: (datasetId, patch) => set((state) => ({
    selection: state.selection ? updateAnalysisSelectionItem(state.selection, datasetId, patch) : null,
  })),
  clear: () => set({ toolId: null, selection: null }),
}));

function currentSector(): RoiSector | null {
  const state = useApp.getState();
  const sector = state.activeId ? state.mapSector[state.activeId] : undefined;
  if (!sector) return null;
  return {
    qMin: Math.min(sector.secMin, sector.secMax),
    qMax: Math.max(sector.secMin, sector.secMax),
    phiMin: Math.min(sector.phiMin, sector.phiMax),
    phiMax: Math.max(sector.phiMin, sector.phiMax),
  };
}

/** Snapshot the current app selection for a tool. This is session UI state,
 * not project state: opening/cancelling a workbench cannot dirty the project. */
export function seedAnalysisSelection(toolId: string, source: AnalysisSelectionSource): AnalysisSelection {
  const state = useApp.getState();
  const range = plotRangeSelection({
    qfitRoi: state.qfitRoi,
    qfitRoiFor: state.qfitRoiFor,
    integral: state.integral,
    selection: state.selection,
    activeId: state.activeId,
    xKey: state.xKey,
    plottedX: () => {
      const dataset = state.datasets.find((entry) => entry.id === state.activeId);
      if (!dataset) return null;
      return state.xKey == null
        ? dataset.data.time
        : dataset.data.values.map((row) => row[state.xKey!]);
    },
  });
  const selection = captureAnalysisSelection({
    datasets: state.datasets,
    activeId: state.activeId,
    selectedIds: state.selectedIds,
    xKey: state.xKey,
    yKeys: state.yKeys,
    seriesOrder: state.seriesOrder,
    errKeys: state.errKeys,
    selection: state.selection,
    range,
    mapRoi: state.mapRoi,
    mapRuler: state.mapRuler,
    mapSector: currentSector(),
  }, source);
  useAnalysisSelection.getState().setSelection(toolId, selection);
  return selection;
}

export function selectionForTool(toolId: string): AnalysisSelection {
  const current = useAnalysisSelection.getState();
  return current.toolId === toolId && current.selection
    ? current.selection
    : seedAnalysisSelection(toolId, "tool-default");
}

export function clearSelectionForTool(toolId: string): void {
  if (useAnalysisSelection.getState().toolId === toolId) useAnalysisSelection.getState().clear();
}

/** Latest item after an async boundary; unlike a captured hook value this
 * cannot apply an earlier worksheet's rows to newly resolved data. */
export function selectionItemForTool(toolId: string, datasetId: string) {
  const state = useAnalysisSelection.getState();
  return state.toolId === toolId
    ? state.selection?.items.find((item) => item.datasetId === datasetId)
    : undefined;
}

/** Imperative dependencies for a batch run, read afresh after async edges. */
export function analysisBatchRuntime() {
  const state = useApp.getState();
  return {
    datasets: state.datasets,
    resolveDataset: state.resolveDataset,
    recordHistory: state.recordHistory,
  };
}

/** Worksheet column/row gesture -> the same contract used by plot and Library
 * launches. The Analysis Center adopts this seed for whichever tool is chosen. */
export function seedWorksheetAnalysisSelection(datasetId: string, columns: readonly number[], rows: readonly number[]): AnalysisSelection | null {
  const state = useApp.getState();
  const dataset = state.datasets.find((entry) => entry.id === datasetId);
  if (!dataset) return null;
  const factorKeys = [...new Set(columns)].filter((column) =>
    column >= 0 && isCategorical(channelModelingType(dataset, column)));
  const plotColumns = columns.filter((column) => !factorKeys.includes(column));
  const spec = selectionToSpec(dataset.data, dataset.id, plotColumns);
  const selection = captureAnalysisSelection({
    datasets: state.datasets,
    activeId: dataset.id,
    selectedIds: [dataset.id],
    xKey: spec?.zones.x?.channel ?? null,
    yKeys: spec?.zones.y.map((field) => field.channel) ?? null,
    seriesOrder: null,
    errKeys: errKeysFromBindings(dataset.errorRoles ?? []),
    selection: rows.length ? { datasetId, rows } : null,
    range: null,
  }, "worksheet");
  if (selection.items[0]) selection.items[0] = { ...selection.items[0], factorKeys };
  useAnalysisSelection.getState().setSelection("analysis-center", selection);
  return selection;
}
