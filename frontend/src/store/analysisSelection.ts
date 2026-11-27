import { create } from "zustand";

import type { AnalysisSelection, AnalysisSelectionSource } from "../lib/analysisSelection";
import { captureAnalysisSelection, updateAnalysisSelectionItem } from "../lib/analysisSelection";
import type { RowRange } from "../lib/rowRange";
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
export function seedAnalysisSelection(toolId: string, source: AnalysisSelectionSource, keepSameItems = false): AnalysisSelection {
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
  // A re-seed that captured the SAME inputs only changes the source label: hand the tool back
  // its own items (same identity), so an effect keyed on the selected item does not re-run.
  const held = useAnalysisSelection.getState();
  // A re-seed the plot drives (source "tool-default") must not silently drop a
  // row range the user set on this tool: carry it onto the same worksheet.
  // Explicit re-seeds (Refresh, Analysis Center, a worksheet handoff) start clean.
  if (source === "tool-default" && held.toolId === toolId && held.selection) {
    for (const item of selection.items) {
      const kept = held.selection.items.find((entry) => entry.datasetId === item.datasetId)?.rowRange;
      if (kept) item.rowRange = kept;
    }
  }
  if (keepSameItems && held.toolId === toolId && held.selection && JSON.stringify(held.selection.items) === JSON.stringify(selection.items)) {
    const same = held.selection.source === source ? held.selection : { ...held.selection, source };
    if (same !== held.selection) held.setSelection(toolId, same);
    return same;
  }
  held.setSelection(toolId, selection);
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
    analysisResults: state.analysisResults,
    resolveDataset: state.resolveDataset,
    recordHistory: state.recordHistory,
    setStatus: state.setStatus,
  };
}

/** Worksheet column/row gesture -> the same contract used by plot and Library
 * launches. The Analysis Center adopts this seed for whichever tool is chosen. */
export function seedWorksheetAnalysisSelection(
  datasetId: string, columns: readonly number[], rows: readonly number[], rowRange: RowRange | null = null,
): AnalysisSelection | null {
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
  if (selection.items[0]) selection.items[0] = { ...selection.items[0], factorKeys, ...(rowRange ? { rowRange } : {}) };
  useAnalysisSelection.getState().setSelection("analysis-center", selection);
  return selection;
}
