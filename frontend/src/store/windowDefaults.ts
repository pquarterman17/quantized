// Dataset-aware defaults and the invariant main plot window, extracted from
// the pinned window-management slice.
import { bookDefaultHiddenChannels, errorRoleViewDefaults } from "../lib/errorbars";
import { isTechniqueChange, techniqueViewDefaults } from "../lib/techniqueDefaults";
import { applyTechniqueMemory, type TechniqueViewMemoryMap } from "../lib/techniqueViewMemory";
import { cascadeGeometry, defaultPlotView, type PlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { createPlotWindowDocument } from "./windowDocuments";

export interface DatasetViewDefaultsOptions {
  /** The view a GENUINE dataset switch is leaving (setActive to another id,
   *  an import, a window rebind): its coordinate-tied decorations and tick
   *  formats reset too (`switchDecorationReset`). Omitted by split/reimport,
   *  whose rows keep the same coordinates. */
  outgoing?: SwitchDecorations;
}

/** The view fields tied to the outgoing dataset's coordinates. */
export const SWITCH_DECORATIONS = ["refLines", "regionShades", "annotations", "shapes", "xFmt", "yFmt", "y2Fmt"] as const;
type SwitchDecorations = Pick<PlotView, (typeof SWITCH_DECORATIONS)[number]>;

/** What a genuine dataset switch drops from `view`: ref lines, region shades,
 *  data-anchored annotations/shapes (page-anchored ones are not tied to the
 *  data and stay) and non-default tick formats. Only the fields that change,
 *  so an undecorated view keeps every reference ({} = nothing to drop). */
export function switchDecorationReset(view: SwitchDecorations): Partial<PlotView> {
  const blank = defaultPlotView() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SWITCH_DECORATIONS) {
    const v: unknown = view[k];
    // Ref lines and shades carry no anchor, so the filter empties them.
    const next = Array.isArray(v) ? v.filter((m: { anchor?: string }) => m.anchor === "page") : blank[k];
    if (JSON.stringify(next) !== JSON.stringify(v)) out[k] = next;
  }
  return out as Partial<PlotView>;
}

export function datasetViewDefaults(
  dataset: Dataset | undefined,
  previous?: Dataset,
  memory: TechniqueViewMemoryMap = {},
  options: DatasetViewDefaultsOptions = {},
): Partial<PlotView> {
  const remembered = applyTechniqueMemory(dataset, memory);
  // A parser's peak-list hint (io/jcamp.py, io/spc.py): markers, not joined
  // lines, per channel -- under any style memory remembers for that channel.
  const seriesStyles: PlotView["seriesStyles"] = {};
  if (dataset?.data.metadata?.default_trace === "Scatter")
    dataset.data.labels.forEach((_, i) => (seriesStyles[i] = { marker: true, width: 0 }));
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
    seriesStyles,
    xReversed: dataset?.data.metadata?.x_reversed === true, // IR wavenumber (io/technique.py)
    seriesLabels: {},
    // With a dataset, both come from its error layer just below.
    errKeys: {},
    seriesOrder: null,
    hiddenChannels: [],
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    ...(options.outgoing ? switchDecorationReset(options.outgoing) : {}),
    // The error layer, below memory (memory > defaults): Origin designations,
    // parser hints and error ROLES, all bound as whiskers and hidden as curves
    // (errorRoleViewDefaults widens defaultErrKeys / originHiddenChannels). An
    // error-role column (a CSV's "err" beside "signal") is hidden on EVERY
    // rebind — import included, like Origin. It used to apply to Quick Plot
    // only, so an import drew the error column as its own Y trace.
    ...(dataset ? bookErrorLayer(dataset) : {}),
    ...(remembered
      ? { ...remembered, seriesStyles: { ...seriesStyles, ...remembered.seriesStyles } }
      : isTechniqueChange(dataset, previous) ? techniqueViewDefaults(dataset) : {}),
  };
}

/** The error layer plus the book's own-X rule: a Y that belongs to a
 *  SECONDARY X column is held back from the one-X default plot too
 *  (lib/errorbars.ts's `bookDefaultHiddenChannels`), so it is never drawn
 *  against the book's first X. Uses the worksheet's Set As designations. */
function bookErrorLayer(
  dataset: NonNullable<Parameters<typeof errorRoleViewDefaults>[0]> & Parameters<typeof bookDefaultHiddenChannels>[0],
): { errKeys: Record<number, number>; hiddenChannels: number[] } {
  const layer = errorRoleViewDefaults(dataset);
  const hidden = new Set([...layer.hiddenChannels, ...bookDefaultHiddenChannels(dataset)]);
  return { errKeys: layer.errKeys, hiddenChannels: [...hidden].sort((a, b) => a - b) };
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
