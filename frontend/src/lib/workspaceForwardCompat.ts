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
// "derived" means 0.34 DROPS the value, but a NAMED regenerator in this build
// rebuilds the part that matters from data 0.34 keeps, so it does not force v6
// (refusing a whole project over a cache would be worse than redrawing it).
// The one derived field is `FigureDocument.overlays` (gap audit 5 lane C): a
// figure's saved fit curve. 0.34 drops it on open + save but keeps the
// dataset's `fitSpec`; on open this build's regenerator,
// store/overlayRestore.restoreSavedFitOverlay (gap audit 6 lane K), redraws a
// CURVE FIT's curve on the FOCUSED window from those saved parameters. A 0.34
// round trip therefore loses, until the user fits again:
//   * the Curve Fit band (the regenerated curve has none);
//   * the fit in every plot window but the focused one;
//   * every EDITABLE FIGURE's fit (Library figures, Build source figure and
//     Batch Figure Builder output, and the Figure Pages built from them);
//   * fits with no `fitSpec` the regenerator can evaluate: Peak Analyzer (and
//     its fitted background), Quick Fit, equation, ODR, global, bumps and
//     reflectivity curves.
// Measured with the procedure below; the set of derived fields is pinned by
// workspaceForwardCompat.test.ts, so a new one is a deliberate decision.
//
// Report figure blocks store their export request (`ReportFigureBlock.spec`)
// opaquely, in 0.34 too: its `analysis_overlays` flags are kept by 0.34
// (measured), whose backend ignores them (FigureRequest drops unknown keys), so
// a 0.34 render of such a block titles its Y axis the old way. REPORT_FIGURE_SPEC
// records that class.
//
// EXTENDING (a branch that adds a persisted field):
// 1. tsc names the map to edit; classify the field. "v034" only for fields that
//    existed in v0.34.0 (they will not be new).
// 2. For a new field, measure it against v0.34.0 with the procedure above, then
//    mark it "gated" (lost) or "kept-by-034" (carried through). "derived" (lost,
//    yet no v6) only with a named regenerator over data 0.34 keeps, a test that
//    exercises that regenerator, the real losses listed above, and an entry in
//    the test's pinned DERIVED list -- never as a way around v6.
// 3. For "gated", add the matching FEATURES case in
//    workspaceForwardCompat.test.ts (the test lists any missing one).
// 4. A field on a type with no map here (for example a map 3-D view in the map
//    state, or a new key in a fit spec): add a `Record<keyof T, V034Class>` map,
//    its container in `featuresV034WouldDrop`, and its prefix in the test's
//    CONTAINERS list. Dataset fields (e.g. `hiddenCols`, `frozenCols`) only need
//    an entry in DATASET below: datasets are checked on `doc.datasets[i]`.

import type { AxisFormat } from "./axisFormat";
import type { FigureSpec } from "./api/figures";
import type { ErrorBinding } from "./errorRoles";
import type { FigureDocument } from "./figureDocument";
import type { MapViewState } from "./mapView";
import type { PlotView, PlotWindow } from "./plotview";
import type { DisplayBlock } from "./plotspec2";
import type { RecipeMapView, RecipeVisual } from "./plotRecipeSchema";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { FigureOverrides } from "./figureOverrides";
import type { MapAnnotation } from "./mapView";
import type { InsetView } from "./plotviewDecor";
import type { StatMarks, StatPicks } from "./plotviewSanitize";
import type { Annotation, Dataset, ReferenceStick, RefLine, RegionShade, Shape } from "./types";

export type V034Class = "v034" | "gated" | "kept-by-034" | "derived";
type Classify<T> = Record<keyof T, V034Class>;

const V = "v034" as const;
const G = "gated" as const;
const K = "kept-by-034" as const;
const D = "derived" as const;

export const PLOT_VIEW: Classify<PlotView> = {
  yScale: V, xScale: V, showGrid: V, showLegend: V, legendPos: V, legendXY: V, legendSize: V, legendFrameXY: V,
  legendStatic: V, legendTitle: V, axisLabelOffsets: V, axisLabelStyles: V, plotTemplate: V, showAxisBox: V,
  xReversed: V, stackMode: V, insetMode: V, inset: V, polarMode: V, statMode: V, statHideEmptyLevels: V,
  statShowGroupN: V, statShowSummary: V, statMarks: V, statPicks: V, xLim: V, yLim: V, xStep: V, yStep: V,
  xFmt: V, yFmt: V, y2Fmt: V, plotTitle: V, xAxisLabel: V, yAxisLabel: V, xKey: V, yKeys: V, groupKey: V,
  facetKey: V, y2Keys: V, y2Lim: V, y2Scale: V, y2Step: V, y2AxisLabel: V, refLines: V, annotations: V,
  regionShades: V, shapes: V, seriesStyles: V, seriesLabels: V, errKeys: V, seriesOrder: V, hiddenChannels: V,
  waterfall: V, waterfallDx: V, panelFit: V, pageSetup: V,
  layers: G, exchangeXY: G, yAxes: G, yAxisOf: G, seriesRamp: G,
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
  prob: G, custom: G, cross: G, reverse: G, rotate: G, offset: G, grid: G, top: G, prefix: G, suffix: G, divideMark: G,
};

// Publication (export) styles ARE sanitized by 0.34: new keys are dropped.
export const EXPORT_SERIES_STYLE: Classify<ExportSeriesStyle> = {
  color: V, width: V, line: V, marker: V, marker_size: V, marker_shape: V, fill: V, color_by: V, colormap: V,
  step: V, bars: V, legend: V, colorDerived: V,
  marker_fill: G, error_cap: G, error_width: G, error_color: G, error_band: G, marker_edge: G, marker_face: G,
  marker_alpha: G, marker_every: G, ramp_rank: G, size_by: G, size_range: G, drop_lines: G, connect: G,
};

// The canonical figure document: a window's `document`, an editable figure.
// A document's error binding (`bindings.errors[]`). 0.34's `errorBindings`
// rebuilds each element from channel/target/axis/side alone, so the Origin-apply
// marker is dropped on open + save (measured the same way). The bar itself
// survives; only the next Origin apply would then take it for the user's, so a
// file holding a marker is written as version 6.
export const ERROR_BINDING: Classify<ErrorBinding> = { channel: V, target: V, axis: V, side: V, origin: G };

export const FIGURE_DOCUMENT: Classify<FigureDocument> = {
  schema: V, version: V, id: V, name: V, bindings: V, data: V, plot: V, output: V, publication: V,
  overlays: D,
};

/** Export-request keys a report figure block's opaque `spec` gained since 0.34. */
export const REPORT_FIGURE_SPEC: Partial<Record<keyof FigureSpec, V034Class>> = { analysis_overlays: K };

export const DISPLAY_BLOCK: Classify<DisplayBlock> = { series: V, order: V, labels: V, ramp: G };

export const RECIPE_VISUAL: Classify<RecipeVisual> = {
  mark: V, xScale: V, yScale: V, y2Scale: V, xRange: V, yRange: V, y2Range: V, xFmt: V, yFmt: V, y2Fmt: V,
  axisBreaks: V, refLines: V, showLegend: V, legendPos: V, legendXY: V, legendSize: V, legendTitle: V,
  legendStatic: V, stackMode: V, waterfall: V, waterfallDx: V, plotTemplate: V, seriesStyles: V, seriesLabels: V,
  seriesOrder: V, hiddenChannels: V, decorations: V, compositionKind: V,
  yAxes: G, yAxisOf: G,
};

// A text label. v0.34.0's two annotation sanitizers (plotviewDecor's, used by the
// view, plot-spec decor and recipes, and figureOverridesSanitize's) pick known
// keys, so a `dot` is dropped on open + save, and since an absent `dot` means
// "draw the dot" the loss is permanent and undetectable: gated, and only
// `dot: false` counts (see checkType). Measured against `git archive v0.34.0`.
export const ANNOTATION: Classify<Annotation> = {
  id: V, groupId: V, x: V, y: V, text: V, axis: V, size: V, anchor: V, frame: V,
  dot: G,
};
// The annotation's text-box backing rect (`Annotation.frame`), in every 0.34 file.
export const ANNOTATION_FRAME: Classify<NonNullable<Annotation["frame"]>> = { fill: V, stroke: V, opacity: V, pad: V };

// The other persisted decoration elements. Each type existed in v0.34.0 with
// exactly these keys (`git show v0.34.0:frontend/src/lib/...`), so a NEW key
// fails `tsc` here until it is classified, instead of being credited to the
// parent list field. The kitchen sink fills one `Required<T>` element of each.
export const SHAPE: Classify<Shape> = {
  id: V, groupId: V, kind: V, x1: V, y1: V, x2: V, y2: V, anchor: V, stroke: V, fill: V, opacity: V, width: V, dash: V,
};
export const REF_LINE: Classify<RefLine> = { id: V, axis: V, value: V, label: V, groupId: V, groupLabel: V, stick: V };
export const REGION_SHADE: Classify<RegionShade> = { id: V, x1: V, x2: V, y1: V, y2: V, fill: V, axis: V, fullHeight: V };
export const INSET_VIEW: Classify<InsetView> = { x: V, y: V, y2: V, yZoom: V, at: V, lines: V };
export const STAT_MARKS: Classify<StatMarks> = {
  points: V, jitter: V, jitterWidth: V, summary: V, errorBars: V, connectMeans: V, labelRotation: V, labelWrap: V,
};
// The Stat Stage picks (`PlotView.statPicks`): 0.34's sanitizeStatPicks keeps
// only the keys it lists, so an Origin 100 % stack would reopen as a plain
// stack of raw values, and its saved Y range would be lost.
export const STAT_PICKS: Classify<StatPicks> = {
  mode: V, dist: V, bins: V, fit: V, barStack: V, cols: V, barPercent: G, valueRange: G,
};
// A map view's pinned text (`mapViews[id].annotations`): a different type from `Annotation`.
export const MAP_ANNOTATION: Classify<MapAnnotation> = { id: V, x: V, y: V, text: V, space: V };
// The export-request object persisted in figure documents (publication deltas,
// templates). `layers` is wire-only: sanitizeFigureOverrides never persists it.
export type OvList<K extends keyof FigureOverrides> = NonNullable<FigureOverrides[K]> extends readonly (infer E)[] ? E : NonNullable<FigureOverrides[K]>;
// The wire elements inside an overrides object (snake_case, no ids). Same story.
export const OVERRIDE_SHAPE: Classify<OvList<"shapes">> = {
  kind: V, x1: V, y1: V, x2: V, y2: V, anchor: V, stroke: V, fill: V, opacity: V, width: V, dash: V,
};
export const OVERRIDE_REF_LINE: Classify<OvList<"ref_lines">> = { axis: V, value: V, label: V, group_id: V, group_label: V, stick: V };
export const OVERRIDE_REGION_SHADE: Classify<OvList<"region_shades">> = { x1: V, x2: V, y1: V, y2: V, fill: V, axis: V, full_height: V };
export const OVERRIDE_INSET: Classify<OvList<"inset">> = { x: V, y: V, y2: V, at: V, lines: V };
// Nested objects inside the elements above (and inside FigureOverrides), each a
// v0.34 type whose keys 0.34's sanitizers pick by name: a new key on any of them
// is lost on a 0.34 round trip unless classified here (tsc forces it).
export const REFERENCE_STICK: Classify<ReferenceStick> = {
  intensity: V, baseline: V, height: V, color: V, visible: V, showLabel: V,
};
export const OVERRIDE_STICK: Classify<NonNullable<OvList<"ref_lines">["stick"]>> = {
  intensity: V, baseline: V, height: V, color: V, visible: V, show_label: V,
};
export const OVERRIDE_LEGEND: Classify<NonNullable<FigureOverrides["legend"]>> = { show: V, loc: V, frame: V, anchor: V, title: V };
export const OVERRIDE_TICKS: Classify<NonNullable<FigureOverrides["ticks"]>> = { dir: V, len: V, minor: V };
export const OVERRIDE_SPINES: Classify<NonNullable<FigureOverrides["spines"]>> = { top: V, right: V };
/** `margins` and `page_pad` share one shape (asserted below). */
export const OVERRIDE_BOX: Classify<NonNullable<FigureOverrides["margins"]>> = { left: V, right: V, top: V, bottom: V };
type _Margins = keyof NonNullable<FigureOverrides["margins"]>;
type _PagePad = keyof NonNullable<FigureOverrides["page_pad"]>;
export const OVERRIDE_BOX_SHARED: [_Margins] extends [_PagePad] ? ([_PagePad] extends [_Margins] ? true : never) : never = true;
export const FIGURE_OVERRIDES: Classify<FigureOverrides> = {
  font_size: V, font_name: V, title_size: V, label_size: V, tick_size: V, legend_size: V, legend: V, ticks: V,
  spines: V, x_lim: V, x_reversed: V, y_lim: V, y2_lim: V, margins: V, page_pad: V, grid: V, annotations: V,
  x_breaks: V, shapes: V, ref_lines: V, region_shades: V, inset: V,
  // Wire-only like `layers`: built from the gated `PlotView.exchangeXY` at
  // export time, never persisted by sanitizeFigureOverrides.
  layers: K, exchange_xy: K,
};

// The export-request element is a subset of Annotation: a new key must be one.
type _OverrideAnnotationIsAnnotation = Exclude<
  keyof NonNullable<FigureOverrides["annotations"]>[number],
  keyof Annotation
> extends never ? true : never;
export const OVERRIDE_ANNOTATION_OK: _OverrideAnnotationIsAnnotation = true;
// The per-dataset map view (`.dwk` `mapViews[datasetId]`). 0.34's
// sanitizeMapView keeps only the five fields it knows, so the static 3-D view is
// dropped on a 0.34 open + save (measured with the `git archive v0.34.0` procedure).
export const MAP_VIEW: Classify<MapViewState> = {
  colormap: V, logZ: V, colorLimits: V, slices: V, annotations: V,
  view3d: G,
};

// A plot recipe's captured map view (`plotRecipes[].map`): 0.34's sanitizeMapView
// keeps colormap/logZ/colorLimits only (measured the same way).
export const RECIPE_MAP_VIEW: Classify<RecipeMapView> = {
  colormap: V, logZ: V, colorLimits: V,
  view3d: G,
};

export const DATASET: Classify<Dataset> = {
  id: V, name: V, data: V, raw: V, corrections: V, bgRef: V, fitSpec: V, peakTable: V, reflFits: V, notes: V,
  tags: V, group: V, folderId: V, order: V, formulas: V, formulaErrors: V, derivedFrom: V, analysisRecipe: V,
  channelRoles: V, columnDesignations: V, errorRoles: V, importedAt: V, channelTypes: V, excludedRows: V,
  filter: V, pending: V, source: V, versionOf: V, workbookId: V,
  linkedCurves: G, columnProps: G, hiddenCols: G, frozenCols: G,
};

// Top-level `.dwk` keys added after v0.34.0. 0.34's parseWorkspace builds its
// result field by field, so an unknown top-level key is dropped on open + save
// (measured: its parse and serialize name every key and have no
// `savedRecodeMappings`): a saved Recode mapping would be lost, so it is gated.
// (Top-level keys 0.34 already carried are not listed.)
export const WORKSPACE_TOP: Classify<{ savedRecodeMappings: unknown }> = { savedRecodeMappings: G };

/** Every classification map by type name (the test's ratchet reads this). */
export const CLASSIFICATIONS: Readonly<Record<string, Readonly<Record<string, V034Class>>>> = {
  PlotView: PLOT_VIEW,
  PlotWindow: PLOT_WINDOW,
  SeriesStyle: SERIES_STYLE,
  AxisFormat: AXIS_FORMAT,
  Workspace: WORKSPACE_TOP,
  ExportSeriesStyle: EXPORT_SERIES_STYLE,
  DisplayBlock: DISPLAY_BLOCK,
  RecipeVisual: RECIPE_VISUAL,
  Annotation: ANNOTATION,
  AnnotationFrame: ANNOTATION_FRAME,
  Shape: SHAPE,
  RefLine: REF_LINE,
  RegionShade: REGION_SHADE,
  InsetView: INSET_VIEW,
  StatMarks: STAT_MARKS,
  StatPicks: STAT_PICKS,
  MapAnnotation: MAP_ANNOTATION,
  FigureOverrides: FIGURE_OVERRIDES,
  OverrideShape: OVERRIDE_SHAPE,
  OverrideRefLine: OVERRIDE_REF_LINE,
  OverrideRegionShade: OVERRIDE_REGION_SHADE,
  OverrideInset: OVERRIDE_INSET,
  ReferenceStick: REFERENCE_STICK,
  OverrideStick: OVERRIDE_STICK,
  OverrideLegend: OVERRIDE_LEGEND,
  OverrideTicks: OVERRIDE_TICKS,
  OverrideSpines: OVERRIDE_SPINES,
  OverrideBox: OVERRIDE_BOX,
  MapViewState: MAP_VIEW,
  RecipeMapView: RECIPE_MAP_VIEW,
  Dataset: DATASET,
  FigureDocument: FIGURE_DOCUMENT,
  ErrorBinding: ERROR_BINDING,
};

/** A field value v0.34.0 drops although the field itself is a v0.34 one. */
export const GATED_VALUES = ["AxisFormat.base=2"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== false && !(Array.isArray(v) && !v.length) && !(isObj(v) && !Object.keys(v).length);
const gatedOf = (m: Readonly<Record<string, V034Class>>): string[] => Object.keys(m).filter((k) => m[k] === "gated");
const GATED: Record<string, string[]> = Object.fromEntries(Object.entries(CLASSIFICATIONS).map(([t, m]) => [t, gatedOf(m)]));

const FALSE_ONLY = new Set(["Annotation.dot", "AxisFormat.divideMark"]);

function checkType(o: unknown, type: string, found: Set<string>): void {
  if (!isObj(o)) return;
  for (const k of GATED[type]) {
    // `dot: false` and `divideMark: false` are the only values that carry information (absent = shown).
    if (FALSE_ONLY.has(`${type}.${k}`) ? o[k] === false : present(o[k])) found.add(`${type}.${k}`);
  }
  if (type === "AxisFormat" && o.base !== undefined && o.base !== "e") found.add("AxisFormat.base=2");
}

function checkDocument(d: unknown, found: Set<string>): void {
  checkType(d, "FigureDocument", found);
  const errors = isObj(d) && isObj(d.bindings) ? d.bindings.errors : undefined;
  for (const b of Array.isArray(errors) ? errors : []) checkType(b, "ErrorBinding", found);
}

/** The gated features (`Type.field`) in a serialized `.dwk` document: what
 *  v0.34.0 would lose on open + save. Empty for a file 0.34 reads in full. */
export function featuresV034WouldDrop(doc: unknown): string[] {
  const found = new Set<string>();
  if (!isObj(doc)) return [];
  checkType(doc, "Workspace", found);
  // Typed containers, by path. Dataset cells (`data`/`raw`) are never walked.
  const datasets = Array.isArray(doc.datasets) ? doc.datasets : [];
  for (const d of datasets) checkType(d, "Dataset", found);
  for (const w of Array.isArray(doc.plotWindows) ? doc.plotWindows : []) {
    checkType(w, "PlotWindow", found);
    if (isObj(w)) checkDocument(w.document, found);
  }
  for (const f of Array.isArray(doc.editableFigures) ? doc.editableFigures : []) checkDocument(f, found);
  for (const s of Array.isArray(doc.savedPlotSpecs) ? doc.savedPlotSpecs : []) {
    if (isObj(s) && isObj(s.spec)) checkType(s.spec.display, "DisplayBlock", found);
  }
  if (isObj(doc.mapViews)) for (const m of Object.values(doc.mapViews)) checkType(m, "MapViewState", found);
  for (const r of Array.isArray(doc.plotRecipes) ? doc.plotRecipes : []) if (isObj(r)) checkType(r.map, "RecipeMapView", found);
  // Views, recipe visuals, axis formats and export style arrays live in many
  // containers (windows, figure documents, recipes, pages): found by shape.
  const visit = (v: unknown, key: string): void => {
    if (Array.isArray(v)) {
      if (!v.length || typeof v[0] !== "object") return; // cells / numbers: nothing to find
      if (key === "seriesStyles") for (const st of v) checkType(st, "ExportSeriesStyle", found);
      if (key === "annotations") for (const a of v) checkType(a, "Annotation", found);
      for (const x of v) visit(x, key);
      return;
    }
    if (!isObj(v)) return;
    if ("seriesStyles" in v && "yFmt" in v) checkType(v, "mark" in v && "axisBreaks" in v ? "RecipeVisual" : "PlotView", found);
    if (key === "xFmt" || key === "yFmt" || key === "y2Fmt") checkType(v, "AxisFormat", found);
    if (key === "statPicks") checkType(v, "StatPicks", found);
    for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  for (const [k, x] of Object.entries(doc)) {
    if (k === "datasets") {
      for (const d of datasets) if (isObj(d)) for (const [dk, dx] of Object.entries(d)) if (dk !== "data" && dk !== "raw") visit(dx, dk);
    } else visit(x, k);
  }
  return [...found].sort();
}
