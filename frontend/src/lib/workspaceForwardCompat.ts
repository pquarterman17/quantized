// Forward compatibility of a saved `.dwk` with the released v0.34.0.
//
// v0.34.0 reads a workspace field by field. A field it does not know is either
// carried through untouched on open + save ("kept-by-034") or silently dropped
// ("gated"). A file holding a gated field is written as version 6
// (`WORKSPACE_VERSION_NEW_FEATURES`), which v0.34.0 refuses outright, so a 0.34
// user can neither lose the feature nor overwrite the file without it.
//
// The CLASSIFICATION MAPS below are the ratchet: each is a `Record` over every
// key of a persisted type, so adding a field to the type fails `tsc -b` until the
// field is classified here. "gated" fields are what `featuresV034WouldDrop`
// reports, and `workspaceForwardCompat.test.ts` requires one FEATURES case per
// gated entry and walks a kitchen-sink save so that a new field outside these
// types (a new container) fails too.
//
// Every class was measured, not assumed: a file using each new field was opened
// and re-saved by v0.34.0's own parseWorkspace/serializeWorkspace (the
// `git archive v0.34.0` procedure in `__fixtures__/workspace/README.md`).
// "kept-by-034" means 0.34 keeps the value but does not draw it.
//
// EXTENDING (a branch that adds a persisted field):
// 1. tsc names the map to edit; classify the field. "v034" only for fields that
//    existed in v0.34.0 (they will not be new).
// 2. For a new field, measure it against v0.34.0 with the procedure above, then
//    mark it "gated" (lost) or "kept-by-034" (carried through).
// 3. For "gated", add the matching FEATURES case in
//    workspaceForwardCompat.test.ts (the test lists any missing one).
// 4. A field on a type with no map here (for example a map 3-D view in the map
//    state, or a new key in a fit spec): add a `Record<keyof T, V034Class>` map,
//    its container in `featuresV034WouldDrop`, and its prefix in the test's
//    CONTAINERS list. Dataset fields (e.g. `hiddenCols`, `frozenCols`) only need
//    an entry in DATASET below: datasets are checked on `doc.datasets[i]`.

import type { AxisFormat } from "./axisFormat";
import type { PlotView, PlotWindow } from "./plotview";
import type { DisplayBlock } from "./plotspec2";
import type { RecipeVisual } from "./plotRecipeSchema";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { Dataset } from "./types";

export type V034Class = "v034" | "gated" | "kept-by-034";
type Classify<T> = Record<keyof T, V034Class>;

const V = "v034" as const;
const G = "gated" as const;
const K = "kept-by-034" as const;

export const PLOT_VIEW: Classify<PlotView> = {
  yScale: V, xScale: V, showGrid: V, showLegend: V, legendPos: V, legendXY: V, legendSize: V, legendFrameXY: V,
  legendStatic: V, legendTitle: V, axisLabelOffsets: V, axisLabelStyles: V, plotTemplate: V, showAxisBox: V,
  xReversed: V, stackMode: V, insetMode: V, inset: V, polarMode: V, statMode: V, statHideEmptyLevels: V,
  statShowGroupN: V, statShowSummary: V, statMarks: V, statPicks: V, xLim: V, yLim: V, xStep: V, yStep: V,
  xFmt: V, yFmt: V, y2Fmt: V, plotTitle: V, xAxisLabel: V, yAxisLabel: V, xKey: V, yKeys: V, groupKey: V,
  facetKey: V, y2Keys: V, y2Lim: V, y2Scale: V, y2Step: V, y2AxisLabel: V, refLines: V, annotations: V,
  regionShades: V, shapes: V, seriesStyles: V, seriesLabels: V, errKeys: V, seriesOrder: V, hiddenChannels: V,
  waterfall: V, waterfallDx: V, panelFit: V, pageSetup: V,
  layers: G, yAxes: G, yAxisOf: G, seriesRamp: G,
};

export const PLOT_WINDOW: Classify<PlotWindow> = {
  id: V, kind: V, title: V, datasetId: V, geometry: V, z: V, winState: V, view: V, ["document"]: V, bg: V, // computed key: not a document write (architecture F1 guard)
  linkGroup: V, snapshot: V, pinned: V, panel: V,
  linkYGroup: G,
};

// 0.34's sanitizePlotView passes `seriesStyles` through as an unchecked cast,
// so every new per-series key survives a 0.34 open + save (measured).
export const SERIES_STYLE: Classify<SeriesStyle> = {
  color: V, width: V, line: V, marker: V, markerSize: V, markerShape: V, fill: V, colorBy: V, colormap: V,
  step: V, logOffset: V, bars: V, explicit: V,
  markerFill: K, markerEdge: K, markerFillColor: K, markerAlpha: K, markerEvery: K, rampRank: K, errorBar: K,
  sizeBy: K, sizeRange: K, dropLines: K, connect: K,
};

export const AXIS_FORMAT: Classify<AxisFormat> = {
  mode: V, digits: V, divide: V, minor: V, ticks: V, size: V, base: V, breaks: V,
  prob: G, custom: G, cross: G, reverse: G, rotate: G, offset: G, grid: G, top: G,
};

// Publication (export) styles ARE sanitized by 0.34: new keys are dropped.
export const EXPORT_SERIES_STYLE: Classify<ExportSeriesStyle> = {
  color: V, width: V, line: V, marker: V, marker_size: V, marker_shape: V, fill: V, color_by: V, colormap: V,
  step: V, bars: V, legend: V, colorDerived: V,
  marker_fill: G, error_cap: G, error_width: G, error_color: G, error_band: G, marker_edge: G, marker_face: G,
  marker_alpha: G, marker_every: G, ramp_rank: G, size_by: G, size_range: G, drop_lines: G, connect: G,
};

export const DISPLAY_BLOCK: Classify<DisplayBlock> = { series: V, order: V, labels: V, ramp: G };

export const RECIPE_VISUAL: Classify<RecipeVisual> = {
  mark: V, xScale: V, yScale: V, y2Scale: V, xRange: V, yRange: V, y2Range: V, xFmt: V, yFmt: V, y2Fmt: V,
  axisBreaks: V, refLines: V, showLegend: V, legendPos: V, legendXY: V, legendSize: V, legendTitle: V,
  legendStatic: V, stackMode: V, waterfall: V, waterfallDx: V, plotTemplate: V, seriesStyles: V, seriesLabels: V,
  seriesOrder: V, hiddenChannels: V, decorations: V, compositionKind: V,
  yAxes: G, yAxisOf: G,
};

export const DATASET: Classify<Dataset> = {
  id: V, name: V, data: V, raw: V, corrections: V, bgRef: V, fitSpec: V, peakTable: V, reflFits: V, notes: V,
  tags: V, group: V, folderId: V, order: V, formulas: V, formulaErrors: V, derivedFrom: V, analysisRecipe: V,
  channelRoles: V, columnDesignations: V, errorRoles: V, importedAt: V, channelTypes: V, excludedRows: V,
  filter: V, pending: V, source: V, versionOf: V, workbookId: V,
  linkedCurves: G, columnProps: G, hiddenCols: G, frozenCols: G,
};

/** Every classification map by type name (the test's ratchet reads this). */
export const CLASSIFICATIONS: Readonly<Record<string, Readonly<Record<string, V034Class>>>> = {
  PlotView: PLOT_VIEW,
  PlotWindow: PLOT_WINDOW,
  SeriesStyle: SERIES_STYLE,
  AxisFormat: AXIS_FORMAT,
  ExportSeriesStyle: EXPORT_SERIES_STYLE,
  DisplayBlock: DISPLAY_BLOCK,
  RecipeVisual: RECIPE_VISUAL,
  Dataset: DATASET,
};

/** A field value v0.34.0 drops although the field itself is a v0.34 one. */
export const GATED_VALUES = ["AxisFormat.base=2"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== false && !(Array.isArray(v) && !v.length) && !(isObj(v) && !Object.keys(v).length);
const gatedOf = (m: Readonly<Record<string, V034Class>>): string[] => Object.keys(m).filter((k) => m[k] === "gated");
const GATED: Record<string, string[]> = Object.fromEntries(Object.entries(CLASSIFICATIONS).map(([t, m]) => [t, gatedOf(m)]));

function checkType(o: unknown, type: string, found: Set<string>): void {
  if (!isObj(o)) return;
  for (const k of GATED[type]) if (present(o[k])) found.add(`${type}.${k}`);
  if (type === "AxisFormat" && o.base !== undefined && o.base !== "e") found.add("AxisFormat.base=2");
}

/** The gated features (`Type.field`) in a serialized `.dwk` document: what
 *  v0.34.0 would lose on open + save. Empty for a file 0.34 reads in full. */
export function featuresV034WouldDrop(doc: unknown): string[] {
  const found = new Set<string>();
  if (!isObj(doc)) return [];
  // Typed containers, by path. Dataset cells (`data`/`raw`) are never walked.
  const datasets = Array.isArray(doc.datasets) ? doc.datasets : [];
  for (const d of datasets) checkType(d, "Dataset", found);
  for (const w of Array.isArray(doc.plotWindows) ? doc.plotWindows : []) checkType(w, "PlotWindow", found);
  for (const s of Array.isArray(doc.savedPlotSpecs) ? doc.savedPlotSpecs : []) {
    if (isObj(s) && isObj(s.spec)) checkType(s.spec.display, "DisplayBlock", found);
  }
  // Views, recipe visuals, axis formats and export style arrays live in many
  // containers (windows, figure documents, recipes, pages): found by shape.
  const visit = (v: unknown, key: string): void => {
    if (Array.isArray(v)) {
      if (!v.length || typeof v[0] !== "object") return; // cells / numbers: nothing to find
      if (key === "seriesStyles") for (const st of v) checkType(st, "ExportSeriesStyle", found);
      for (const x of v) visit(x, key);
      return;
    }
    if (!isObj(v)) return;
    if ("seriesStyles" in v && "yFmt" in v) checkType(v, "mark" in v && "axisBreaks" in v ? "RecipeVisual" : "PlotView", found);
    if (key === "xFmt" || key === "yFmt" || key === "y2Fmt") checkType(v, "AxisFormat", found);
    for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  for (const [k, x] of Object.entries(doc)) {
    if (k === "datasets") {
      for (const d of datasets) if (isObj(d)) for (const [dk, dx] of Object.entries(d)) if (dk !== "data" && dk !== "raw") visit(dx, dk);
    } else visit(x, k);
  }
  return [...found].sort();
}
