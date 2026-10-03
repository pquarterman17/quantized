// Dataset-aware defaults and the invariant main plot window, extracted from
// the pinned window-management slice.
import { defaultErrKeys, errorRoleViewDefaults, originHiddenChannels } from "../lib/errorbars";
import { isTechniqueChange, techniqueViewDefaults } from "../lib/techniqueDefaults";
import { applyTechniqueMemory, type TechniqueViewMemoryMap } from "../lib/techniqueViewMemory";
import { cascadeGeometry, defaultPlotView, type PlotView, type PlotWindow } from "../lib/plotview";
import type { AxisFormat, Dataset } from "../lib/types";
import { createPlotWindowDocument } from "./windowDocuments";

export interface DatasetViewDefaultsOptions {
  /** Quick Plot's canonical mapping (`lib/quickPlot.ts`) opts in: bind the
   *  dataset's error-role columns to their series (`errorRoleViewDefaults`)
   *  instead of plotting them as curves. Off for every silent rebind
   *  (import/switch/reimport), whose defaults this leaves byte-identical. */
  errorRoles?: boolean;
  /** The view a GENUINE dataset switch is leaving (setActive to another id,
   *  an import, a window rebind): its coordinate-tied decorations and tick
   *  formats reset too (`switchDecorationReset`). Omitted by split/reimport,
   *  whose rows keep the same coordinates. */
  outgoing?: SwitchDecorations;
}

type SwitchDecorations = Pick<PlotView, "refLines" | "regionShades" | "annotations" | "shapes" | "xFmt" | "yFmt" | "y2Fmt">;

const isAutoFmt = (f: AxisFormat | null): boolean => !f || (f.mode === "auto" && f.digits === 2);

/** What a genuine dataset switch drops from `view`: ref lines, region shades,
 *  data-anchored annotations/shapes (page-anchored ones are not tied to the
 *  data and stay) and non-default tick formats. Only the fields that change,
 *  so an undecorated view keeps every reference ({} = nothing to drop). */
export function switchDecorationReset(view: SwitchDecorations): Partial<PlotView> {
  const out: Partial<PlotView> = {};
  const onPage = (m: { anchor?: "data" | "page" }) => m.anchor === "page";
  if (view.refLines.length) out.refLines = [];
  if (view.regionShades.length) out.regionShades = [];
  if (!view.annotations.every(onPage)) out.annotations = view.annotations.filter(onPage);
  if (!view.shapes.every(onPage)) out.shapes = view.shapes.filter(onPage);
  if (!isAutoFmt(view.xFmt)) out.xFmt = { mode: "auto", digits: 2 };
  if (!isAutoFmt(view.yFmt)) out.yFmt = { mode: "auto", digits: 2 };
  if (view.y2Fmt) out.y2Fmt = null;
  return out;
}

export function datasetViewDefaults(
  dataset: Dataset | undefined,
  previous?: Dataset,
  memory: TechniqueViewMemoryMap = {},
  options: DatasetViewDefaultsOptions = {},
): Partial<PlotView> {
  const remembered = applyTechniqueMemory(dataset, memory);
  return {
    xKey: null,
    yKeys: null,
    // P1.5 review P1: groupKey indexes the active dataset's columns exactly
    // like xKey/yKeys -- omitted here, it rode a stale index into a
    // differently-shaped dataset on setActive/addDataset/a shape-changed
    // reimport (lib/figureDocumentReimport.ts already reset the SAVED
    // editableFigures copy of this same field for the identical reason).
    groupKey: null,
    // F4.4: facetKey is the SAME class of channel-indexed field -- a facet
    // binding built against the OLD dataset's columns is meaningless (or
    // silently wrong) applied to a new one, so a genuine dataset switch
    // resets it exactly like groupKey.
    facetKey: null,
    y2Keys: null,
    y2Lim: null,
    y2Scale: null,
    y2Step: null,
    y2AxisLabel: "",
    // Axis-title overrides describe the dataset that just left this window.
    // Keeping them across a rebind made a SIMS workbook whose parser correctly
    // reports `Depth (um)` display a prior magnetometry plot's `H (Oe)` title.
    // Blank means "derive from the incoming dataset", not "hide the title".
    xAxisLabel: "",
    yAxisLabel: "",
    seriesStyles: {},
    seriesLabels: {},
    errKeys: dataset ? defaultErrKeys(dataset.data) : {},
    seriesOrder: null,
    hiddenChannels: dataset ? originHiddenChannels(dataset.data) : [],
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    // Below memory, like the two error seeds it widens (memory > defaults).
    ...(options.outgoing ? switchDecorationReset(options.outgoing) : {}),
    ...(dataset && options.errorRoles ? errorRoleViewDefaults(dataset) : {}),
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
