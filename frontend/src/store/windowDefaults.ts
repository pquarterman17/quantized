// Dataset-aware defaults and the invariant main plot window, extracted from
// the pinned window-management slice.
import { defaultErrKeys, originHiddenChannels } from "../lib/errorbars";
import { isTechniqueChange, techniqueViewDefaults } from "../lib/techniqueDefaults";
import { applyTechniqueMemory, type TechniqueViewMemoryMap } from "../lib/techniqueViewMemory";
import { cascadeGeometry, defaultPlotView, type PlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { createPlotWindowDocument } from "./windowDocuments";

export function datasetViewDefaults(
  dataset: Dataset | undefined,
  previous?: Dataset,
  memory: TechniqueViewMemoryMap = {},
): Partial<PlotView> {
  const remembered = applyTechniqueMemory(dataset, memory);
  return {
    xKey: null,
    yKeys: null,
    y2Keys: null,
    y2Lim: null,
    y2Scale: null,
    y2Step: null,
    y2AxisLabel: "",
    seriesStyles: {},
    seriesLabels: {},
    errKeys: dataset ? defaultErrKeys(dataset.data) : {},
    seriesOrder: null,
    hiddenChannels: dataset ? originHiddenChannels(dataset.data) : [],
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    ...(remembered ?? (isTechniqueChange(dataset, previous) ? techniqueViewDefaults(dataset) : {})),
  };
}

export function mainWindow(datasetId: string | null, id: string): PlotWindow {
  const title = "";
  const view = defaultPlotView();
  return {
    id,
    kind: "plot",
    title,
    datasetId,
    geometry: cascadeGeometry(0),
    z: 0,
    winState: "maximized",
    view,
    document: createPlotWindowDocument(id, title, datasetId, view),
    bg: "theme",
    linkGroup: null,
    pinned: false,
  };
}
