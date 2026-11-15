// Dataset-aware defaults and the invariant main plot window, extracted from
// the pinned window-management slice.
import { bookDefaultHiddenChannels, errorRoleViewDefaults } from "../lib/errorbars";
import { textAxisFallbackChannel } from "../lib/modeling";
import { isTechniqueChange, techniqueViewDefaults } from "../lib/techniqueDefaults";
import { applyTechniqueMemory, type TechniqueViewMemoryMap } from "../lib/techniqueViewMemory";
import { cascadeGeometry, defaultPlotView, type PlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import type { TemplateSeed } from "../lib/defaultGraphTemplate";
import type { AppState } from "./useApp";
import { createPlotWindowDocument } from "./windowDocuments";

export interface DatasetViewDefaultsOptions {
  /** The view a GENUINE dataset switch is leaving (setActive to another id,
   *  an import, a window rebind): its coordinate-tied decorations and tick
   *  formats reset too (`switchDecorationReset`). Omitted by split/reimport,
   *  whose rows keep the same coordinates. */
  outgoing?: SwitchDecorations;
  /** The rebound window's id: when it carries a default-template seed
   *  (`templateSeeds`), its tick formats are what the switch resets to and its
   *  series sit under the dataset's own. Otherwise the built-in defaults. */
  win?: string | null;
}

/** The view fields tied to the outgoing dataset's coordinates. */
export const SWITCH_DECORATIONS = ["refLines", "regionShades", "annotations", "shapes", "xFmt", "yFmt", "y2Fmt"] as const;
/** The view fields that describe the outgoing dataset itself, blanked on a
 *  genuine switch (figures audit B1/#9): its plot title ("Sample A: ..."
 *  leaked onto every later dataset), its legend title, and the Statistics
 *  plot mode, whose group/value picks name the old dataset's columns. */
export const SWITCH_DESCRIPTIONS = ["plotTitle", "legendTitle", "statMode"] as const;
type SwitchDecorations = Pick<PlotView, (typeof SWITCH_DECORATIONS)[number] | (typeof SWITCH_DESCRIPTIONS)[number]>;

/** The default graph template's current seed (gap audit 5 #1), installed by
 *  the LAZY `lib/defaultGraphTemplate.ts` once its preference is read. null =
 *  none, and also before that chunk loads: a graph opened in that instant is
 *  plain (fail closed, never a half-applied template). */
let defaultSeed: (() => TemplateSeed | null) | null = null;
export const setNewGraphStyler = (next: (() => TemplateSeed | null) | null): void => void (defaultSeed = next);
/** Window id -> the template seed (chrome + series) that window was opened
 *  with. Only the new-graph paths below and the lazy module's empty-window
 *  restyle set it; a window without one never sees the template (restores,
 *  saved figures, recipes, Origin recovery, Graph Builder, reimport, split).
 *  Session-only: never saved, so a restored graph compares against the plain
 *  view. */
export const templateSeeds = new Map<string, TemplateSeed>();

/** What a genuine dataset switch drops from `view`: ref lines, region shades,
 *  data-anchored annotations/shapes (page-anchored ones are not tied to the
 *  data and stay), non-default tick formats and the `SWITCH_DESCRIPTIONS`.
 *  Only the fields that change, so an undecorated view keeps every reference
 *  ({} = nothing to drop). A template-seeded window's tick formats go back to
 *  its seed's. */
export function switchDecorationReset(view: SwitchDecorations, seed?: TemplateSeed): Partial<PlotView> {
  const blank = { ...defaultPlotView(), ...seed?.chrome } as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of [...SWITCH_DECORATIONS, ...SWITCH_DESCRIPTIONS]) {
    const v: unknown = view[k];
    // Ref lines and shades carry no anchor, so the filter empties them.
    const next = Array.isArray(v) ? v.filter((m: { anchor?: string }) => m.anchor === "page") : blank[k];
    if (JSON.stringify(next) !== JSON.stringify(v)) out[k] = next;
  }
  return out as Partial<PlotView>;
}

/** A NEW graph of `dataset`: its fresh binding, under the default template
 *  (`seed`, the current default unless given) when one is set. */
export function newGraph(dataset?: Dataset, memory?: TechniqueViewMemoryMap, seed = defaultSeed?.()): PlotView {
  const view = { ...defaultPlotView(), ...datasetViewDefaults(dataset, undefined, memory) };
  return seed ? seed.apply(view, dataset) : view;
}

/** Open a new graph window for `datasetId` and mark it with its seed. The
 *  app's own new-graph paths only: an import or Library open that opens a
 *  window, Plot in New Window, a drop on empty canvas. */
export function openNewGraph(s: Pick<AppState, "datasets" | "createWindow">, datasetId: string | null, title?: string): string {
  const seed = defaultSeed?.();
  const id = s.createWindow(datasetId, newGraph(s.datasets.find((d) => d.id === datasetId), undefined, seed), title);
  if (seed) templateSeeds.set(id, seed);
  return id;
}

export function datasetViewDefaults(
  dataset: Dataset | undefined,
  previous?: Dataset,
  memory: TechniqueViewMemoryMap = {},
  options: DatasetViewDefaultsOptions = {},
): Partial<PlotView> {
  const remembered = applyTechniqueMemory(dataset, memory);
  const seed = templateSeeds.get(options.win ?? "");
  // A parser's peak-list hint (io/jcamp.py, io/spc.py): markers, not joined
  // lines, per channel -- under any style memory remembers for that channel.
  const seriesStyles: PlotView["seriesStyles"] = {};
  if (dataset?.data.metadata?.default_trace === "Scatter")
    dataset.data.labels.forEach((_, i) => (seriesStyles[i] = { marker: true, width: 0 }));
  const out: Partial<PlotView> = {
    // Figures-audit #8: a text first column (Sample,Value,SD) plots as its
    // category labels, not as codes against a 1..N row index.
    xKey: dataset ? textAxisFallbackChannel(dataset) : null,
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
    yAxes: [], yAxisOf: {}, // Y3+ (lib/multiY.ts) describe the dataset that left
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
    ...(options.outgoing ? switchDecorationReset(options.outgoing, seed) : {}),
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
  // A seeded window's series sit UNDER the dataset's own (the hint, memory).
  if (seed && dataset) out.seriesStyles = { ...seed.seriesFor(dataset, out), ...out.seriesStyles };
  return out;
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
