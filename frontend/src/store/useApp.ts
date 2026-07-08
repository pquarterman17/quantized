// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.

import { create } from "zustand";

import type { CorrectionsRequest, FftSpectralResult, IntegrateResponse } from "../lib/api";
import {
  applyCorrections as applyCorrectionsApi,
  fftSpectral,
  fitModel,
  guessImportSettings,
  parseImportText,
  peaksIntegrate,
  statsDescriptive,
  uploadFile,
} from "../lib/api";
import { cloneDataStruct } from "../lib/dataset";
import { centralDifference, sortByX, type DerivativeResult } from "../lib/differentiate";
import { computeCursorReadout } from "../lib/gadgetCursors";
import type { Measurement } from "../lib/measure";
import { defaultErrKeys, originHiddenChannels } from "../lib/errorbars";
import { setFormatOpts, type Notation } from "../lib/format";
import { applyFormulas, baseColumns, recomputeData } from "../lib/formula";
import { lit } from "../lib/macro";
import {
  makeStep,
  moveStep as movePipelineStep,
  regenerateStep,
  type PipelineStep,
  type StepKind,
} from "../lib/pipeline";
import {
  createFolder as treeCreateFolder,
  deleteFolder as treeDeleteFolder,
  moveDatasetToFolder as treeMoveDatasetToFolder,
  moveFolder as treeMoveFolder,
  renameFolder as treeRenameFolder,
} from "../lib/foldertree";
import { is2DMap } from "../lib/mapdata";
import { mergeDatasets } from "../lib/merge";
import type { WorkspaceState } from "../lib/workspace";
import {
  buildOriginFigureEntries,
  doubleYPartner,
  figureChannelSelection,
  figureLabel,
  figureLayerFamily,
  originFigureAnnotations,
  originLegendPos,
  resolveFigurePanels,
  type OriginFigureEntry,
} from "../lib/originFigures";
import { planOriginFolders } from "../lib/originFolders";
import { computePanelLayout } from "../lib/originPanels";
import type { SpatialPanel } from "../lib/multipanel";
import { pruneReportRefs, type ReportEntry, type ReportSheet } from "../lib/report";
import { buildOverlayDataset, overlayCurveStyles } from "../lib/originOverlay";
import { applyPalette, normalizePalette } from "../lib/palettes";
import { isActive } from "../lib/datafilter";
import type { FwhmResult } from "../lib/peakwidth";
import { effectiveChannels } from "../lib/plotdata";
import { docRenderable, type FigureDoc } from "../lib/figuredoc";
import { downstreamOf, markStale, type RecalcMode } from "../lib/recalc";
import { firstVisiblePlottedChannel, selectRoiRows, type GadgetMode } from "../lib/quickfit";
import { activeRowIndices, analysisData, droppedRows, expandToFull, sanitizeExcluded, toggleExcluded } from "../lib/rowstate";
import {
  addRecentEntry,
  clearRecentMeta,
  loadRecent,
  saveRecent,
  type RecentFile,
} from "../lib/recentFiles";
import { toast } from "./toasts";
import type {
  Annotation,
  AxisFormat,
  BaselineOverlay,
  CalcResult,
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  DataFilter,
  Dataset,
  DataStruct,
  FitOverlay,
  FolderNode,
  ModelingType,
  OriginFigure,
  PeakOverlay,
  RefLine,
  RsmPeak,
  SeriesStyle,
} from "../lib/types";

/** Recompute a dataset's computed columns from its current base (no-op without
 *  formulas). Routed through after any base-data mutation (cell edit, corrections). */
const recompute = (d: Dataset): Dataset =>
  d.formulas?.length ? { ...d, data: recomputeData(d.data, d.formulas) } : d;

/** Drop the resolved target on any Origin figure entry pointing at a removed
 *  dataset (the figure itself stays listed — just disabled again, same as an
 *  import whose source hint never resolved). */
const pruneOriginFigureRefs = (figures: OriginFigureEntry[], removedIds: ReadonlySet<string>): OriginFigureEntry[] =>
  figures.map((f) => (f.datasetId && removedIds.has(f.datasetId) ? { ...f, datasetId: null } : f));

let _refSeq = 0;
let _annSeq = 0;

let _idSeq = 0;
const nextDatasetId = (): string => `ds-${Date.now().toString(36)}-${++_idSeq}`;
const nextFolderId = (): string => `fld-${Date.now().toString(36)}-${++_idSeq}`;
const nextReportId = (): string => `rep-${Date.now().toString(36)}-${++_idSeq}`;

// Names successive clipboard pastes "pasted data 1", "pasted data 2", … (gap #47).
let _pasteSeq = 0;

// Recalc scheduler internals (#1): a module-level debounce timer plus an
// in-progress guard so the recalc's own applyCorrections calls never re-mark
// or re-schedule (the loop would otherwise feed itself).
let _recalcTimer: ReturnType<typeof setTimeout> | null = null;
let _recalcInProgress = false;

// Quick-fit gadget (#33) internals: a module-level debounce timer, mirroring
// the recalc scheduler above — a burst of ROI-drag moves triggers ONE fit.
let _qfitTimer: ReturnType<typeof setTimeout> | null = null;

export type Theme = "dark" | "light";
export type Accent = "violet" | "teal" | "ocean" | "amber" | "rose";
export type Density = "compact" | "regular" | "comfy";
export type StageTab = "plot" | "map" | "worksheet";
/** How excluded/filtered rows (#50/#53) render on the plot: "hide" drops them
 *  (gaps); "grey" draws them as muted markers. Fits exclude them either way. */
export type ExcludedDisplay = "hide" | "grey";
export type PlotTool =
  | "zoom"
  | "pan"
  | "cursor"
  | "region"
  | "select"
  | "measure"
  | "stats"
  | "integ"
  | "fwhm"
  | "qfit";
/** Committed integral region from the ∫ tool (area under the curve). */
export interface IntegralResult {
  xlo: number;
  xhi: number;
  area: number;
}

/** A layer SLD handed from the calculators SLD tab to the reflectivity workshop
 *  (cross-panel hook). `sld` is in Å⁻² (the reflectivity layer unit — the SLD tab
 *  converts its ×10⁻⁶ Å⁻² display value). `label` is a short provenance note. */
export interface ReflectivitySeed {
  sld: number;
  label?: string;
}

/** The stat-stage pickers the Graph Builder hands over when it sends a box/violin
 *  spec to the stage (cross-panel hook, mirrors ReflectivitySeed). `useStatStage`
 *  consumes it once and clears it. `groupCol` = the categorical column to group
 *  by (null = per-plotted-channel fallback); `valueCol` = the value channel. */
export interface StatStageSeed {
  mode: "box" | "violin";
  groupCol: number | null;
  valueCol: number;
}

/** Default stage tab for a newly-activated dataset: a 2-D map (XRDML RSM) opens
 *  in the Map view, a 1-D scan in the Plot view — but never override an explicit
 *  Worksheet choice (the user is inspecting the data grid). */
export function nextStageTab(d: Dataset, current: StageTab): StageTab {
  if (current === "worksheet") return current;
  return is2DMap(d.data) ? "map" : "plot";
}
export type LegendPos = "ne" | "nw" | "se" | "sw";
// Keys the Preferences dialog can set through the generic setPref action.
export type PrefKey =
  | "theme"
  | "accent"
  | "density"
  | "palette"
  | "reduceMotion"
  | "wheelZoom"
  | "defaultTrace"
  | "defaultLineWidth"
  | "defaultGrid"
  | "antialias"
  | "sigFigs"
  | "notation"
  | "confirmRemove"
  | "excludedDisplay";

interface AppState {
  datasets: Dataset[];
  activeId: string | null;
  // Multi-selection for bulk ops (Delete key). `activeId` stays the plotted
  // "primary"; ctrl/shift-click extend `selectedIds` without changing the plot.
  selectedIds: string[];
  // Origin project figures (plan item 18): every graph window recovered from
  // an imported .opj, tagged with the import's file stem and (best-effort)
  // the dataset id it plots. `datasetId` is null when the figure's loose
  // source reference didn't resolve — the Library shows those disabled.
  originFigures: OriginFigureEntry[];
  // Report sheets (#36): named analysis reports (curve fits, peak tables,
  // stats) living in the library. `datasetId` ties one back to its source
  // dataset (nulled if that dataset is removed — the report itself stays, it
  // is a computed artifact, not a view). Round-trips .dwk.
  reports: ReportEntry[];
  // The report currently open in the viewer ToolWindow (null = closed).
  openReportId: string | null;
  // Figure documents (#12): named figures that re-open/re-edit/re-export at
  // any time. `figureDocSeed` hands an opened doc to the figure builder.
  figureDocs: FigureDoc[];
  figureDocSeed: FigureDoc | null;
  // Recalc engine (#1): auto re-runs downstream corrections/fits when data
  // changes; manual only flips staleness (#4 badges); off does neither.
  recalcMode: RecalcMode;
  // Dirty nodes awaiting recalculation (dataset ids). A dataset is stale when
  // its corrections need re-deriving (its bg source changed); a fit is stale
  // when its dataset's data changed under a saved fitSpec.
  staleDatasets: string[];
  staleFits: string[];
  // Library folder tree (project-organization plan, Approach B). Pure
  // organization over the flat `datasets[]` array — datasets point in via
  // `Dataset.folderId`; folders never gate row-state. Round-trips .dwk v2.
  folders: FolderNode[];
  // Expanded folder ids (Library tree UI state); persisted so a project reopens
  // with the same folders open. Round-trips .dwk v2.
  expandedFolders: string[];
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  stageTab: StageTab;
  theme: Theme;
  accent: Accent;
  density: Density;
  palette: string; // series colour-cycle preset (overrides --series-1..8)
  // Behavioural prefs (Preferences dialog). reduceMotion + sigFigs/notation apply
  // live; defaultGrid seeds showGrid at startup; the rest persist for later use.
  reduceMotion: boolean;
  wheelZoom: boolean;
  defaultTrace: string;
  defaultLineWidth: number;
  defaultGrid: boolean;
  antialias: boolean;
  sigFigs: number;
  notation: Notation;
  confirmRemove: boolean;
  excludedDisplay: ExcludedDisplay;
  prefsOpen: boolean;
  yLog: boolean;
  xLog: boolean;
  showGrid: boolean; // draw the plot grid lines
  showLegend: boolean; // show the floating legend overlay
  legendPos: LegendPos; // which corner the floating legend pins to
  plotTemplate: string; // on-screen publication template (base font + line width)
  showAxisBox: boolean; // draw a full frame around the plot area
  stackMode: boolean; // multi-panel: one stacked sub-plot per channel
  // Spatial multi-panel apply (decode-plan #36): set by `applyOriginFigure`
  // when a multi-layer Origin figure's layers all resolve to a dataset +
  // plotted channels — each panel owns its OWN dataset/ranges instead of
  // splitting the active dataset's channels (MultiPanelStage renders this
  // in preference to the plain per-channel split when non-null). Cleared by
  // `setStackMode` and `setActive` so a manual toggle or picking a different
  // dataset never shows a stale spatial arrangement.
  spatialPanels: SpatialPanel[] | null;
  insetMode: boolean; // show a magnifier inset over the plot
  polarMode: boolean; // render the active series in polar (angle vs radius)
  statMode: boolean; // render the Statistics stage (box/violin/qq/histogram, gap #16)
  xLim: [number, number] | null; // explicit X range (null = autoscale)
  yLim: [number, number] | null; // explicit Y range (null = autoscale)
  xFmt: AxisFormat; // X-axis tick number format
  yFmt: AxisFormat; // Y-axis tick number format (also applied to the secondary axis)
  plotTitle: string; // chart title rendered above the plot ("" = none)
  xAxisLabel: string; // override for the x-axis label ("" = auto from data)
  yAxisLabel: string; // override for the primary y-axis label ("" = auto)
  xKey: number | null; // value channel used as the plot x-axis (null = .time)
  yKeys: number[] | null; // which value channels to plot (null = all)
  y2Keys: number[] | null; // channels drawn on the secondary (right) Y axis
  y2Lim: [number, number] | null; // fixed secondary-Y range (Origin double-Y apply)
  y2Log: boolean | null; // secondary-Y log scale (null = inherit yLog)
  y2AxisLabel: string; // override for the secondary y-axis label ("" = auto)
  refLines: RefLine[]; // fixed X/Y marker lines on the plot
  annotations: Annotation[]; // text labels pinned at data coordinates
  seriesStyles: Record<number, SeriesStyle>; // per-channel color/width/line overrides
  seriesLabels: Record<number, string>; // per-channel display-name overrides (legend rename)
  errKeys: Record<number, number>; // y-channel index → channel holding its ± error (error bars)
  seriesOrder: number[] | null; // explicit plotted-channel draw order (null = natural/yKeys order)
  hiddenChannels: number[]; // channels toggled off via the interactive legend (kept in payload, not drawn)
  waterfall: number; // waterfall offset as a fraction of the y-span (0 = off)
  plotTool: PlotTool;
  // Last x-range picked by the region rubber-band ([x_min,x_max]); the baseline
  // workshop consumes it then resets to null. Drag direction is normalized away.
  regionPicked: [number, number] | null;
  // On-plot analysis results (∫ / ∩ tools). Persist drawn until cleared via the
  // result chip or a dataset change (reset alongside the per-dataset view state).
  integral: IntegralResult | null;
  fwhmResult: FwhmResult | null;
  // Quick-fit gadget (#33): drag an ROI band; a debounced live fit of that
  // region's rows (guard #11: rowstate.analysisData ∩ the ROI) overlays the
  // plot via the shared `fitOverlay` slot (only one fit curve shows at a
  // time — same slot the Curve Fit workshop/recalc use). The chip's explicit
  // "Commit" action durably adopts the model as the dataset's fitSpec; the
  // live drag preview never does (auto-committing every move would spam the
  // recalc graph). Cleared on tool switch, Escape, dataset change, or ✕.
  qfitRoi: [number, number] | null;
  qfitModel: string;
  qfitBusy: boolean;
  qfitResult: CalcResult | null;
  qfitError: string | null;
  // ROI gadget family (#34): generalizes the #33 frame above with a mode
  // selector on the SAME chip. `gadgetMode` picks which of the region's rows
  // gets computed on every ROI move (fit uses the #33 fields above); the other
  // async modes (integrate/stats/fft) share one busy/error pair since only one
  // mode runs at a time. `derivOverlay` mirrors `fitOverlay`'s shape but draws
  // on the secondary axis (a derivative's scale rarely matches the data's).
  // Cursors mode doesn't use the ROI band at all — see `gadgetCursors` below.
  gadgetMode: GadgetMode;
  gadgetBusy: boolean;
  gadgetError: string | null;
  gadgetIntegrateResult: IntegrateResponse | null;
  gadgetStatsResult: CalcResult | null;
  gadgetDerivResult: DerivativeResult | null;
  derivOverlay: FitOverlay | null;
  /** Live FFT preview (recomputed on every ROI move, like the other modes);
   *  "Commit" turns it into a new library dataset (`commitGadgetFft`) rather
   *  than a durable per-dataset spec — there's nothing fitSpec-like to write. */
  gadgetFftPreview: FftSpectralResult | null;
  /** Paired-cursors mode: two independent x positions (unordered — order
   *  carries the Δx/slope sign), placed/dragged by `gadgetCursorsPlugin`. */
  gadgetCursors: [number, number] | null;
  gadgetCursorResult: Measurement | null;
  cmdkOpen: boolean;
  curveFitOpen: boolean;
  hysteresisOpen: boolean;
  peaksOpen: boolean;
  reflectivityOpen: boolean;
  // A pending SLD layer seeded by the calculators SLD tab; consumed once by the
  // reflectivity workshop on open, then cleared (cross-panel hook).
  reflectivitySeed: ReflectivitySeed | null;
  baselineOpen: boolean;
  calculatorsOpen: boolean;
  magToolsOpen: boolean;
  rsmOpen: boolean;
  digitizerOpen: boolean;
  datasetMathOpen: boolean;
  tabulateOpen: boolean;
  distributionOpen: boolean;
  dataFilterOpen: boolean;
  statsChooserOpen: boolean; // the "which test?" front door (#26)
  peakWizardOpen: boolean; // the Peak Analyzer stepper (#31)
  importWizardOpen: boolean; // guess/preview/parse over a saved-filter (#40)
  pipelineOpen: boolean; // the editable pipeline view (#6)
  figureBuilderOpen: boolean;
  graphBuilderOpen: boolean; // the drag-columns-to-wells plot-spec builder (#51)
  // One-shot pickers handed from the Graph Builder to the stat stage when a
  // box/violin spec is sent (consumed + cleared by useStatStage). null = none.
  statStageSeed: StatStageSeed | null;
  waterfallOpen: boolean;
  reflViewOpen: boolean;
  columnSwitcherOpen: boolean; // the JMP-style solo-a-channel flipper (#54)
  shortcutsOpen: boolean;
  // Recent-imports history (File ▸ Recent); persisted via lib/recentFiles.
  recent: RecentFile[];
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null; // markers on the 2D map
  mapMethod: string; // 2D-map regrid interpolation (natural/linear/nearest/idw)
  mapRes: number; // 2D-map grid resolution (nx = ny)
  // Interactive contour overlay (ORIGIN_GAP_PLAN #17 remaining half). Mirrors
  // the export side's `_contour_levels` semantics (calc/figure_map.py) so the
  // on-screen lines and the exported figure agree.
  contourOn: boolean;
  contourLevelCount: number;
  contourScale: "linear" | "log";
  // Macro recorder: when `macroRecording` is on, curated actions append a step;
  // the Inspector card exports `macroSteps` as a reproducible script. Steps are
  // TYPED (lib/pipeline): runnable kinds carry {kind, params} so the pipeline
  // view (#6) edits and re-runs the same list the script exports — one source
  // of truth. `pipelineRunning` suppresses recording while the runner replays
  // steps through these same store actions (no self-recording loops).
  macroRecording: boolean;
  macroSteps: PipelineStep[];
  pipelineRunning: boolean;
  status: string;

  addDataset: (ds: Dataset) => void;
  importFiles: (files: File[]) => Promise<void>;
  // Import ≥2 files and concatenate them row-wise into ONE dataset (gap #47) —
  // the alternative to importFiles' N-separate-datasets result, for same-shape
  // multi-file series (e.g. a scan split across daily files). Falls back to
  // importFiles (separate datasets + a toast) on a shape mismatch or an Origin
  // multi-workbook file, so it never produces a dead import.
  importFilesAppended: (files: File[]) => Promise<void>;
  // Import the OS clipboard's text through the shared paste/import-wizard text
  // engine (`/api/import/guess` + `/parse`, gap #47) into a new dataset named
  // "pasted data N". Tab/comma/semicolon/whitespace tables with or without a
  // header row all work — it's the same guesser the import wizard uses.
  pasteDataFromClipboard: () => Promise<void>;
  // Attach one import's worth of Origin figures (item 18), matched against the
  // dataset ids that same import just created. Internal to importFiles, but a
  // named action so it's directly testable.
  addOriginFigures: (stem: string, figures: OriginFigure[], datasetIds: string[]) => void;
  // Apply a stored figure's plot-state snapshot: activates its resolved
  // dataset and sets the axis ranges + log flags. No-op if unresolved.
  applyOriginFigure: (id: string) => void;
  // Report sheets (#36): add opens the viewer on the new report.
  addReport: (name: string, report: ReportSheet, datasetId?: string | null) => void;
  removeReport: (id: string) => void;
  renameReport: (id: string, name: string) => void;
  setOpenReport: (id: string | null) => void;
  // Recalc engine (#1): mark everything downstream of a data change, run the
  // dirty set now, and record/clear a dataset's re-runnable fit spec.
  // Figure documents (#12).
  addFigureDoc: (doc: FigureDoc) => void;
  removeFigureDoc: (id: string) => void;
  renameFigureDoc: (id: string, name: string) => void;
  duplicateFigureDoc: (id: string) => void;
  openFigureDoc: (id: string) => void;
  clearFigureDocSeed: () => void;
  setRecalcMode: (mode: RecalcMode) => void;
  touchDataset: (id: string) => void;
  recalcNow: () => Promise<void>;
  setFitSpec: (id: string, spec: { model: string } | null) => void;
  loadWorkspace: (ws: WorkspaceState) => void;
  setActive: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectRange: (id: string) => void;
  removeDataset: (id: string) => void;
  removeSelected: () => void;
  // Bulk-remove by explicit id list (item 17's book-family filter dialog) —
  // distinct from removeSelected, which acts on the transient row selection.
  removeDatasets: (ids: string[]) => void;
  // Wipe the whole library (datasets + folders + figures + selection + view
  // state) — the File ▸ Remove all command; reuses loadWorkspace's reset.
  clearAll: () => void;
  // Concatenate the multi-selected datasets (≥2) row-wise into a new dataset.
  mergeSelected: () => void;
  duplicateDataset: (id: string) => void;
  moveDataset: (id: string, dir: -1 | 1) => void;
  renameDataset: (id: string, name: string) => void;
  setCellValue: (id: string, row: number, col: number, value: number) => void;
  addFormula: (id: string, name: string, expr: string) => void;
  removeFormula: (id: string, index: number) => void;
  setDatasetNotes: (id: string, notes: string) => void;
  addDatasetTag: (id: string, tag: string) => void;
  removeDatasetTag: (id: string, tag: string) => void;
  setDatasetGroup: (id: string, group: string) => void;
  // Folder tree (project-organization plan item 1). Thin wrappers over
  // lib/foldertree; datasets stay a flat array (membership is Dataset.folderId).
  createFolder: (parentId: string | null, name?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string, mode?: "reparent" | "cascade") => void;
  moveFolder: (id: string, newParentId: string | null, beforeId?: string) => void;
  moveDatasetToFolder: (id: string, folderId: string | null, beforeId?: string) => void;
  toggleFolderExpanded: (id: string) => void;
  applyCorrections: (
    id: string,
    params: CorrectionParams,
    bg?: { datasetId: string; interp: string },
  ) => Promise<void>;
  resetCorrections: (id: string) => void;
  // Copy `sourceId`'s correction params (+ bg reference) onto every target id,
  // re-deriving each from its own raw. Batch parity with MATLAB "Apply to All".
  applyCorrectionsToMany: (sourceId: string, targetIds: string[]) => Promise<void>;
  toggleLeft: () => void;
  toggleRight: () => void;
  setStageTab: (tab: StageTab) => void;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
  setDensity: (density: Density) => void;
  setPalette: (palette: string) => void;
  // Generic pref setter (used by the Preferences dialog); applies + persists.
  setPref: (key: PrefKey, value: string | number | boolean) => void;
  setPrefsOpen: (open: boolean) => void;
  setYLog: (yLog: boolean) => void;
  setXLog: (xLog: boolean) => void;
  setShowGrid: (showGrid: boolean) => void;
  setShowLegend: (showLegend: boolean) => void;
  setLegendPos: (pos: LegendPos) => void;
  setPlotTemplate: (template: string) => void;
  setShowAxisBox: (show: boolean) => void;
  setStackMode: (stackMode: boolean) => void;
  setInsetMode: (insetMode: boolean) => void;
  setPolarMode: (polarMode: boolean) => void;
  setStatMode: (statMode: boolean) => void;
  setXLim: (xLim: [number, number] | null) => void;
  setYLim: (yLim: [number, number] | null) => void;
  setXFmt: (xFmt: AxisFormat) => void;
  setYFmt: (yFmt: AxisFormat) => void;
  setPlotTitle: (plotTitle: string) => void;
  setXAxisLabel: (xAxisLabel: string) => void;
  setYAxisLabel: (yAxisLabel: string) => void;
  setY2AxisLabel: (y2AxisLabel: string) => void;
  setXKey: (xKey: number | null) => void;
  setYKeys: (yKeys: number[] | null) => void;
  setY2Keys: (y2Keys: number[] | null) => void;
  addRefLine: (axis: "x" | "y", value: number) => void;
  removeRefLine: (id: string) => void;
  updateRefLine: (id: string, value: number) => void;
  addAnnotation: (x: number, y: number, text: string) => void;
  removeAnnotation: (id: string) => void;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  resetSeriesStyle: (channel: number) => void;
  setSeriesLabel: (channel: number, label: string) => void;
  setErrKey: (channel: number, errChannel: number | null) => void;
  setChannelRole: (channel: number, role: ChannelRole | null) => void;
  setChannelType: (channel: number, t: ModelingType | null) => void;
  // Row state (#50): persistent per-row exclusion on a dataset. Excluded rows
  // stay visible but drop from analysis everywhere; round-trips .dwk.
  toggleRowExcluded: (id: string, row: number) => void;
  setRowsExcluded: (id: string, rows: number[]) => void;
  clearRowExclusions: (id: string) => void;
  // Row selection (#50 selection dimension): a transient brush on the active
  // dataset. `selection` is null or {datasetId, rows}; it is "live" only when its
  // datasetId matches activeId, so switching datasets naturally drops it (no
  // reset wiring). The bulk actions turn a selection into persistent exclusions.
  selection: { datasetId: string; rows: number[] } | null;
  toggleRowSelected: (row: number) => void;
  setRowSelection: (rows: number[]) => void;
  clearRowSelection: () => void;
  excludeSelectedRows: () => void;
  keepOnlySelectedRows: () => void;
  // Local data filter (#53): non-destructive per-column predicates that narrow
  // the analysis view of a dataset. Only active predicates are stored.
  setDatasetFilter: (id: string, filter: DataFilter) => void;
  clearDatasetFilter: (id: string) => void;
  setSeriesOrder: (order: number[] | null) => void;
  toggleHidden: (channel: number) => void;
  // Solo one plotted channel (hide all others); null = show all. The column
  // switcher's engine — kept in the store so it's testable.
  soloChannel: (channel: number | null) => void;
  setWaterfall: (waterfall: number) => void;
  setPlotTool: (tool: PlotTool) => void;
  setRegionPicked: (range: [number, number] | null) => void;
  setIntegral: (integral: IntegralResult | null) => void;
  setFwhmResult: (result: FwhmResult | null) => void;
  // Quick-fit gadget (#33): set/clear the ROI (debounces a live re-fit —
  // internal `runQuickFit`), switch the model (re-fits the current ROI, if
  // any), durably commit the current result as the dataset's fitSpec, or
  // clear the gadget entirely (roi + result + chip + its fit overlay).
  setQfitRoi: (roi: [number, number] | null) => void;
  setQfitModel: (model: string) => void;
  runQuickFit: () => Promise<void>;
  commitQfit: () => void;
  // ROI gadget family (#34): mode switch (retriggers a live ROI, if any),
  // the per-mode compute dispatcher, each mode's own compute action, FFT's
  // "commit to a new dataset" ending, and the cursors' own placement setter.
  // `clearQfit` now clears the whole gadget (ROI band + cursors + every
  // mode's result) — it's the dismiss action for the generalized chip.
  setGadgetMode: (mode: GadgetMode) => void;
  runGadget: () => Promise<void>;
  runGadgetIntegrate: () => Promise<void>;
  runGadgetStats: () => Promise<void>;
  runGadgetDifferentiate: () => void;
  runGadgetFft: () => Promise<void>;
  commitGadgetFft: () => void;
  setGadgetCursors: (cursors: [number, number] | null) => void;
  clearQfit: () => void;
  setCmdk: (open: boolean) => void;
  setCurveFitOpen: (open: boolean) => void;
  setHysteresisOpen: (open: boolean) => void;
  setPeaksOpen: (open: boolean) => void;
  setReflectivityOpen: (open: boolean) => void;
  // Send an SLD to the reflectivity workshop as a new layer + open it (SLD→refl).
  seedReflectivityLayer: (seed: ReflectivitySeed) => void;
  clearReflectivitySeed: () => void;
  setBaselineOpen: (open: boolean) => void;
  setCalculatorsOpen: (open: boolean) => void;
  setMagToolsOpen: (open: boolean) => void;
  setRsmOpen: (open: boolean) => void;
  setDigitizerOpen: (open: boolean) => void;
  setDatasetMathOpen: (open: boolean) => void;
  setTabulateOpen: (open: boolean) => void;
  setDistributionOpen: (open: boolean) => void;
  setDataFilterOpen: (open: boolean) => void;
  setStatsChooserOpen: (open: boolean) => void;
  setPeakWizardOpen: (open: boolean) => void;
  setImportWizardOpen: (open: boolean) => void;
  setPipelineOpen: (open: boolean) => void;
  setFigureBuilderOpen: (open: boolean) => void;
  setGraphBuilderOpen: (open: boolean) => void;
  // Send a box/violin Graph Builder spec to the stat stage: store the pickers +
  // switch statMode on; clearStatStageSeed drops the pending pickers once read.
  seedStatStage: (seed: StatStageSeed) => void;
  clearStatStageSeed: () => void;
  setWaterfallOpen: (open: boolean) => void;
  setReflViewOpen: (open: boolean) => void;
  setColumnSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  // Record a successful import in the recent list; clearRecent empties it.
  pushRecent: (name: string, size: number) => void;
  clearRecent: () => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
  setBaselineOverlay: (overlay: BaselineOverlay | null) => void;
  setRsmPeaks: (rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null) => void;
  setMapMethod: (method: string) => void;
  setMapRes: (res: number) => void;
  setContourOn: (on: boolean) => void;
  setContourLevelCount: (n: number) => void;
  setContourScale: (scale: "linear" | "log") => void;
  startMacro: () => void;
  stopMacro: () => void;
  clearMacro: () => void;
  // Append a step IFF recording is on (callers invoke unconditionally — the
  // gate lives here so the "are we recording?" check isn't scattered).
  recordMacro: (
    label: string,
    code: string,
    typed?: { kind: StepKind; params: Record<string, unknown> },
  ) => void;
  // Pipeline view (#6): edit the recorded step list in place.
  updateStepParams: (id: string, params: Record<string, unknown>) => void;
  toggleStep: (id: string) => void;
  removeStep: (id: string) => void;
  moveStep: (id: string, delta: number) => void;
  insertStep: (step: PipelineStep) => void;
  // Replace the whole step list (loading a template, #2).
  loadSteps: (steps: PipelineStep[]) => void;
  setPipelineRunning: (running: boolean) => void;
  setStatus: (status: string) => void;
}

// ── Appearance prefs persisted to localStorage (survive a reload) ──
const PREFS_KEY = "qz.prefs";
const THEMES = ["dark", "light"];
const ACCENTS = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES = ["compact", "regular", "comfy"];

const NOTATIONS = ["auto", "scientific", "fixed"];
const TRACES = ["Line", "Line + markers", "Scatter", "Step"];

// Everything the Preferences dialog (and the Appearance menu) persists. Defaults
// reproduce the app's prior behaviour so nothing changes until a user opts in.
interface Prefs {
  theme: Theme;
  accent: Accent;
  density: Density;
  palette: string;
  reduceMotion: boolean;
  wheelZoom: boolean;
  defaultTrace: string;
  defaultLineWidth: number;
  defaultGrid: boolean;
  antialias: boolean;
  sigFigs: number;
  notation: Notation;
  confirmRemove: boolean;
  excludedDisplay: ExcludedDisplay;
}

const PREF_DEFAULTS: Prefs = {
  theme: "dark",
  accent: "violet",
  density: "regular",
  palette: "default",
  reduceMotion: false,
  wheelZoom: true,
  defaultTrace: "Line",
  defaultLineWidth: 1.5,
  defaultGrid: true,
  antialias: true,
  sigFigs: 6,
  notation: "auto",
  confirmRemove: false,
  excludedDisplay: "hide",
};

function loadPrefs(): Prefs {
  const fb = PREF_DEFAULTS;
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const num = (v: unknown, d: number, lo: number, hi: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    return {
      theme: THEMES.includes(p.theme as string) ? (p.theme as Theme) : fb.theme,
      accent: ACCENTS.includes(p.accent as string) ? (p.accent as Accent) : fb.accent,
      density: DENSITIES.includes(p.density as string) ? (p.density as Density) : fb.density,
      palette: normalizePalette(p.palette),
      reduceMotion: bool(p.reduceMotion, fb.reduceMotion),
      wheelZoom: bool(p.wheelZoom, fb.wheelZoom),
      defaultTrace: TRACES.includes(p.defaultTrace as string) ? (p.defaultTrace as string) : fb.defaultTrace,
      defaultLineWidth: num(p.defaultLineWidth, fb.defaultLineWidth, 0.5, 4),
      defaultGrid: bool(p.defaultGrid, fb.defaultGrid),
      antialias: bool(p.antialias, fb.antialias),
      sigFigs: num(p.sigFigs, fb.sigFigs, 1, 12),
      notation: NOTATIONS.includes(p.notation as string) ? (p.notation as Notation) : fb.notation,
      confirmRemove: bool(p.confirmRemove, fb.confirmRemove),
      excludedDisplay: p.excludedDisplay === "grey" ? "grey" : fb.excludedDisplay,
    };
  } catch {
    return fb;
  }
}

/** Snapshot the pref fields out of the store state. */
function prefsOf(s: AppState): Prefs {
  return {
    theme: s.theme,
    accent: s.accent,
    density: s.density,
    palette: s.palette,
    reduceMotion: s.reduceMotion,
    wheelZoom: s.wheelZoom,
    defaultTrace: s.defaultTrace,
    defaultLineWidth: s.defaultLineWidth,
    defaultGrid: s.defaultGrid,
    antialias: s.antialias,
    sigFigs: s.sigFigs,
    notation: s.notation,
    confirmRemove: s.confirmRemove,
    excludedDisplay: s.excludedDisplay,
  };
}

/** Apply appearance prefs to <html> + the number formatter, then persist all
 *  prefs. Called on load and after every pref change (token system keys off the
 *  data-* attributes; data-reduce-motion drives the motion-killing rule). */
function syncPrefs(s: AppState): void {
  applyPalette(s.palette);
  const el = document.documentElement;
  el.dataset.theme = s.theme;
  el.dataset.accent = s.accent;
  el.dataset.density = s.density;
  if (s.reduceMotion) el.dataset.reduceMotion = "";
  else delete el.dataset.reduceMotion;
  setFormatOpts(s.sigFigs, s.notation);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefsOf(s)));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

const _initialPrefs = loadPrefs();

export const useApp = create<AppState>((set, get) => ({
  datasets: [],
  activeId: null,
  selectedIds: [],
  originFigures: [],
  reports: [],
  openReportId: null,
  figureDocs: [],
  figureDocSeed: null,
  recalcMode: "auto",
  staleDatasets: [],
  staleFits: [],
  folders: [],
  expandedFolders: [],
  leftCollapsed: false,
  rightCollapsed: false,
  stageTab: "plot",
  theme: _initialPrefs.theme,
  accent: _initialPrefs.accent,
  density: _initialPrefs.density,
  palette: _initialPrefs.palette,
  reduceMotion: _initialPrefs.reduceMotion,
  wheelZoom: _initialPrefs.wheelZoom,
  defaultTrace: _initialPrefs.defaultTrace,
  defaultLineWidth: _initialPrefs.defaultLineWidth,
  defaultGrid: _initialPrefs.defaultGrid,
  antialias: _initialPrefs.antialias,
  excludedDisplay: _initialPrefs.excludedDisplay,
  sigFigs: _initialPrefs.sigFigs,
  notation: _initialPrefs.notation,
  confirmRemove: _initialPrefs.confirmRemove,
  prefsOpen: false,
  yLog: false,
  xLog: false,
  showGrid: _initialPrefs.defaultGrid,
  showLegend: true,
  legendPos: "ne",
  plotTemplate: "screen",
  showAxisBox: false,
  stackMode: false,
  spatialPanels: null,
  insetMode: false,
  polarMode: false,
  statMode: false,
  xLim: null,
  yLim: null,
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  plotTitle: "",
  xAxisLabel: "",
  yAxisLabel: "",
  xKey: null,
  yKeys: null,
  y2Keys: null,
  y2Lim: null,
  y2Log: null,
  y2AxisLabel: "",
  refLines: [],
  annotations: [],
  seriesStyles: {},
  seriesLabels: {},
  errKeys: {},
  seriesOrder: null,
  hiddenChannels: [],
  waterfall: 0,
  plotTool: "zoom",
  regionPicked: null,
  selection: null,
  integral: null,
  fwhmResult: null,
  qfitRoi: null,
  qfitModel: "Linear",
  qfitBusy: false,
  qfitResult: null,
  qfitError: null,
  gadgetMode: "fit",
  gadgetBusy: false,
  gadgetError: null,
  gadgetIntegrateResult: null,
  gadgetStatsResult: null,
  gadgetDerivResult: null,
  derivOverlay: null,
  gadgetFftPreview: null,
  gadgetCursors: null,
  gadgetCursorResult: null,
  cmdkOpen: false,
  curveFitOpen: false,
  hysteresisOpen: false,
  peaksOpen: false,
  reflectivityOpen: false,
  reflectivitySeed: null,
  baselineOpen: false,
  calculatorsOpen: false,
  magToolsOpen: false,
  rsmOpen: false,
  digitizerOpen: false,
  datasetMathOpen: false,
  tabulateOpen: false,
  distributionOpen: false,
  dataFilterOpen: false,
  statsChooserOpen: false,
  peakWizardOpen: false,
  importWizardOpen: false,
  pipelineOpen: false,
  figureBuilderOpen: false,
  graphBuilderOpen: false,
  statStageSeed: null,
  waterfallOpen: false,
  reflViewOpen: false,
  columnSwitcherOpen: false,
  shortcutsOpen: false,
  recent: loadRecent(),
  fitOverlay: null,
  peakOverlay: null,
  baselineOverlay: null,
  rsmPeaks: null,
  // 'linear' default: fast (~50 ms) and bit-exact MATLAB parity. 'natural'
  // (true Sibson) is correct but does a per-query Voronoi cavity walk (seconds
  // at 200²), so it's an opt-in quality choice, not the auto-open default.
  mapMethod: "linear",
  mapRes: 200,
  contourOn: false,
  contourLevelCount: 8,
  contourScale: "linear",
  macroRecording: false,
  macroSteps: [],
  pipelineRunning: false,
  status: "starting…",

  addDataset: (ds) =>
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
      selectedIds: [ds.id], // a fresh import is the sole selection
      stageTab: nextStageTab(ds, s.stageTab), // 2-D maps open in the Map view
      xKey: null, // new dataset → x-axis back to .time
      yKeys: null, // new dataset → plot all its channels
      y2Keys: null,
      y2Lim: null,
      y2Log: null, // and reset the secondary-axis assignment
      y2AxisLabel: "",
      seriesStyles: {}, // styles are keyed by channel index → reset per dataset
      seriesLabels: {}, // legend renames are channel-keyed → reset per dataset
      errKeys: defaultErrKeys(ds.data), // Origin Y-error + parser hints (e.g. refl R←dR)
      seriesOrder: null, // draw order is channel-keyed → reset per dataset
      hiddenChannels: originHiddenChannels(ds.data), // hide Origin error + secondary-X columns
      xLim: null, // and autoscale both axes
      yLim: null,
      integral: null, // on-plot analysis results are tied to the old data → clear
      fwhmResult: null,
      qfitRoi: null,
      qfitResult: null,
      qfitBusy: false,
      qfitError: null,
      gadgetBusy: false,
      gadgetError: null,
      gadgetIntegrateResult: null,
      gadgetStatsResult: null,
      gadgetDerivResult: null,
      gadgetFftPreview: null,
      gadgetCursors: null,
      gadgetCursorResult: null,
    })),

  // Upload + parse each picked/dropped file; add to the library (continues on a
  // per-file error so one bad file doesn't abort the batch).
  importFiles: async (files) => {
    let added = 0;
    let lastError = "";
    for (const file of files) {
      get().setStatus(`importing ${file.name}…`);
      try {
        const data = await uploadFile(file);
        const stem = file.name.replace(/\.[^.]+$/, "");
        const figures = data.figures;
        delete data.figures;
        const newIds: string[] = [];
        if (data.books && data.books.length > 1) {
          // Origin project: import every workbook as its own dataset.
          for (const book of data.books) {
            const meta = (book.metadata ?? {}) as Record<string, unknown>;
            const short = String(meta.origin_book ?? "Book");
            const long = String(meta.origin_book_long ?? "");
            const label = long && long !== short ? `${short} — ${long}` : short;
            const id = nextDatasetId();
            get().addDataset({ id, name: `${stem}:${label}`, data: book });
            newIds.push(id);
          }
          // item 4: organize the imported books into a project folder that mirrors
          // Origin's Project Explorer (origin_folder_path) → book → sheet, instead
          // of dumping N workbooks flat into the Library.
          const newIdSet = new Set(newIds);
          const projectDatasets = get().datasets.filter((d) => newIdSet.has(d.id));
          const plan = planOriginFolders(stem, projectDatasets, nextFolderId);
          set((s) => ({
            folders: [...s.folders, ...plan.folders],
            expandedFolders: [...new Set([...s.expandedFolders, ...plan.expanded])],
            datasets: s.datasets.map((d) =>
              plan.membership[d.id] ? { ...d, folderId: plan.membership[d.id] } : d,
            ),
          }));
        } else {
          delete data.books;
          const id = nextDatasetId();
          get().addDataset({ id, name: file.name, data });
          newIds.push(id);
        }
        if (figures?.length) get().addOriginFigures(stem, figures, newIds);
        get().recordMacro(`Import ${file.name}`, `qz.import(${lit(file.name)})`, {
          kind: "import",
          params: { name: file.name },
        });
        get().pushRecent(file.name, file.size);
        added += 1;
      } catch (e) {
        lastError = `${file.name}: ${e instanceof Error ? e.message : "error"}`;
      }
    }
    // A parse failure is the wizard's second front door (#40): the auto-detect
    // path gave up, so point at the manual guess/preview/parse one instead of
    // just reporting the error.
    const hint = " — try the Import wizard (⌘K → Import wizard…)";
    const summary = lastError
      ? `imported ${added}/${files.length} — failed ${lastError}${hint}`
      : `imported ${added} file${added === 1 ? "" : "s"}`;
    get().setStatus(summary);
    if (added > 0) toast(`imported ${added} file${added === 1 ? "" : "s"}`, "ok");
    if (lastError) toast(`${lastError}${hint}`, "danger");
  },

  // Upload every file, then concatenate them row-wise into ONE dataset instead
  // of importFiles' N separate ones (gap #47) — for a same-shape multi-file
  // series (e.g. a scan split across daily files). An Origin multi-workbook
  // file (`data.books`) or a column-count mismatch (mergeDatasets's guard)
  // can't append cleanly, so either degrades to importFiles (N separate
  // datasets) with an explanatory toast — never a dead/half-finished import.
  importFilesAppended: async (files) => {
    if (files.length < 2) {
      toast("append needs ≥2 files — use Import data… for one", "danger");
      return;
    }
    get().setStatus(`importing ${files.length} files to append…`);
    const uploaded: { name: string; size: number; data: DataStruct }[] = [];
    let failReason = "";
    for (const file of files) {
      try {
        const data = await uploadFile(file);
        if (data.books && data.books.length > 1) {
          failReason = `${file.name} is a multi-workbook Origin project — can't append`;
          break;
        }
        uploaded.push({ name: file.name, size: file.size, data });
      } catch (e) {
        failReason = `${file.name}: ${e instanceof Error ? e.message : "error"}`;
        break;
      }
    }
    if (!failReason && uploaded.length === files.length) {
      try {
        const merged = mergeDatasets(
          uploaded.map((u) => u.data),
          uploaded.map((u) => u.name),
        );
        const id = nextDatasetId();
        const name = `${uploaded[0].name} +${uploaded.length - 1} more (appended)`;
        get().addDataset({ id, name, data: merged });
        for (const u of uploaded) get().pushRecent(u.name, u.size);
        get().recordMacro(
          `Import (append) ${uploaded.length} files`,
          `qz.importAppended(${lit(uploaded.map((u) => u.name))})`,
          { kind: "import", params: { names: uploaded.map((u) => u.name) } },
        );
        const msg = `appended ${uploaded.length} files → ${merged.time.length} rows`;
        get().setStatus(msg);
        toast(msg, "ok");
        return;
      } catch (e) {
        failReason = e instanceof Error ? e.message : "append failed (column-count mismatch)";
      }
    }
    // Degrade to N separate datasets rather than a dead import.
    toast(`${failReason} — importing separately instead`, "danger");
    await get().importFiles(files);
  },

  // Import the OS clipboard's text (gap #47) through the same guess/parse text
  // engine that backs the import wizard, so a pasted Excel/Origin selection or
  // any tab/comma/semicolon/whitespace table (with or without a header row)
  // lands as a correctly-parsed dataset — never a second parser.
  pasteDataFromClipboard: async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      const msg = "clipboard read failed — check browser permissions";
      get().setStatus(msg);
      toast(msg, "danger");
      return;
    }
    if (!text.trim()) {
      const msg = "clipboard is empty";
      get().setStatus(msg);
      toast(msg, "danger");
      return;
    }
    get().setStatus("parsing pasted data…");
    try {
      const settings = await guessImportSettings(text);
      const data = await parseImportText(text, settings);
      _pasteSeq += 1;
      const id = nextDatasetId();
      const name = `pasted data ${_pasteSeq}`;
      get().addDataset({ id, name, data });
      get().recordMacro(`Paste ${name}`, `qz.pasteData(${lit(name)})`, {
        kind: "import",
        params: { name },
      });
      const msg = `${name} — ${data.time.length} rows, ${data.labels.length} column${data.labels.length === 1 ? "" : "s"}`;
      get().setStatus(msg);
      toast(msg, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "paste import failed";
      get().setStatus(msg);
      toast(msg, "danger");
    }
  },

  addOriginFigures: (stem, figures, datasetIds) =>
    set((s) => {
      const candidates = s.datasets.filter((d) => datasetIds.includes(d.id));
      const entries = buildOriginFigureEntries(stem, figures, candidates);
      return { originFigures: [...s.originFigures, ...entries] };
    }),
  applyOriginFigure: (id) => {
    const entry = get().originFigures.find((f) => f.id === id);
    if (!entry?.datasetId) return;
    const fig = entry.figure;
    // Cross-book figures (curves spanning ≥2 workbooks) materialize as an
    // overlay dataset (owner decision) so the combined graph Origin showed is
    // reproduced in one plot; re-applying reuses the existing overlay.
    const overlayName = `${entry.stem}:${figureLabel(entry)} (overlay)`;
    // Scope overlay resolution to THIS import's datasets: Origin's default book
    // names (Book1/Book2/…) repeat across separate projects, so resolving
    // against every dataset in the store would silently combine the wrong
    // books. Reuse is keyed on the entry id (not the display name, which can
    // collide across same-stem imports) so re-applying reuses only this
    // figure's own overlay.
    const siblings = get().datasets.filter((d) => entry.siblingIds.includes(d.id));
    const existing = get().datasets.find(
      (d) => (d.data.metadata ?? {}).origin_overlay_source === entry.id,
    );
    const overlay = existing ? null : buildOverlayDataset(fig, siblings);
    if (existing || overlay) {
      let targetId = existing?.id ?? null;
      if (!existing && overlay) {
        targetId = nextDatasetId();
        const stamped = {
          ...overlay,
          metadata: { ...overlay.metadata, origin_overlay_source: entry.id },
        };
        get().addDataset({ id: targetId, name: overlayName, data: stamped });
        toast(`built overlay — ${overlay.labels.length} curves`, "ok");
      }
      if (targetId) {
        get().setActive(targetId);
        const src = existing?.data ?? overlay;
        const n = src?.labels.length ?? 0;
        set({
          xLim: [fig.x_from, fig.x_to],
          yLim: [fig.y_from, fig.y_to],
          xLog: fig.x_log,
          yLog: fig.y_log,
          xKey: null,
          yKeys: Array.from({ length: n }, (_, i) => i),
          // Restore each overlay column's decoded line/scatter look.
          seriesStyles: overlayCurveStyles(src),
          // Origin's real axis titles ("" falls back to the data-derived label).
          xAxisLabel: fig.x_title ?? "",
          yAxisLabel: fig.y_title ?? "",
          // Pin the figure's decoded floating text; REPLACE so re-applying
          // or switching figures never stacks stale marks.
          annotations: originFigureAnnotations([fig], entry.id),
          // Origin's legend placement -> nearest corner preset (decoded box
          // top-left; only when the position decoded, never guessed).
          ...(originLegendPos(fig) ? { legendPos: originLegendPos(fig)! } : {}),
        });
        get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
        return;
      }
    }
    // Origin's double-Y idiom: a 2-layer graph window whose layers both
    // resolved to this SAME dataset. Applying either layer's entry then
    // offers the combined view Origin showed — layer-1 curves on the
    // primary Y axis, layer-2 curves on the secondary (y2) axis — instead
    // of just the clicked layer's own curves. Axis range/log come from the
    // LOWER layer number (Origin draws layer 1's axis as the "main" one).
    const partner = doubleYPartner(entry, get().originFigures);
    const dsForPartner = partner ? get().datasets.find((d) => d.id === entry.datasetId) : null;
    if (partner && dsForPartner) {
      const lower = (entry.figure.layer ?? 1) <= (partner.figure.layer ?? 1) ? entry : partner;
      const upper = lower === entry ? partner : entry;
      const baseSel = figureChannelSelection(lower.figure, dsForPartner);
      const partnerSel = figureChannelSelection(upper.figure, dsForPartner);
      if (baseSel && partnerSel) {
        get().setActive(entry.datasetId);
        set({
          xLim: [lower.figure.x_from, lower.figure.x_to],
          yLim: [lower.figure.y_from, lower.figure.y_to],
          xLog: lower.figure.x_log,
          yLog: lower.figure.y_log,
          xKey: baseSel.xKey,
          // The plotted-channel list derives from yKeys ALONE (y2Keys only tags
          // which of them sit on the right axis), so yKeys must be the UNION of
          // both layers' channels (lower layer first) or layer-2's curves never
          // render. The filter also dedupes a y2 channel that overlaps primary.
          yKeys: [
            ...baseSel.yKeys,
            ...partnerSel.yKeys.filter((k) => !baseSel.yKeys.includes(k)),
          ],
          y2Keys: partnerSel.yKeys,
          // Layer 2's own axis state -> the secondary axis (13.2 #6): range,
          // log flag, and title (falls back to auto when undecoded).
          y2Lim: [upper.figure.y_from, upper.figure.y_to],
          y2Log: upper.figure.y_log,
          y2AxisLabel: upper.figure.y_title ?? "",
          seriesStyles: { ...baseSel.styles, ...partnerSel.styles },
          xAxisLabel: lower.figure.x_title ?? "",
          yAxisLabel: lower.figure.y_title ?? "",
          // Both layers' marks (lower first) — REPLACE, never stack.
          annotations: originFigureAnnotations([lower.figure, upper.figure], entry.id),
          ...(originLegendPos(lower.figure)
            ? { legendPos: originLegendPos(lower.figure)! }
            : {}),
        });
        get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
        return;
      }
      // Either layer's curves didn't map to a channel — fall back below.
    }
    // Multi-panel spatial apply (decode-plan #36): ≥2 same-window layers
    // that didn't (or couldn't) combine as a Y/Y2 pair — the "Fixed Lambdas
    // SI"!Graph6-style 2-stack, or any ≥2-layer composite/panel window.
    // Arrange each layer as its OWN panel, placed per the page's real
    // spatial layout (`originPanels.computePanelLayout` over the family's
    // decoded `frame` quads — falls back to a plain top-to-bottom ordinal
    // stack when the geometry wasn't decoded), when EVERY layer resolves to
    // a dataset + plotted channels (`resolveFigurePanels`, all-or-nothing).
    // Falls through to the clicked layer's own single-layer apply below,
    // with a status note, when any layer doesn't resolve.
    const family = figureLayerFamily(entry, get().originFigures);
    if (family.length >= 2) {
      const panels = resolveFigurePanels(family, get().datasets);
      if (panels) {
        const layout = computePanelLayout(
          family.map((e) => e.figure.frame ?? null),
          family[0].figure.page ?? null,
        );
        const placed: SpatialPanel[] = panels.map((p, i) => ({
          ...p,
          row: layout.placements[i]?.row ?? i,
          col: layout.placements[i]?.col ?? 0,
        }));
        get().setActive(entry.datasetId);
        set({ stackMode: true, spatialPanels: placed });
        get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
        if (!layout.spatial) {
          toast(
            `applied ${placed.length} panels stacked in layer order — page geometry not decoded`,
            "info",
          );
        }
        return;
      }
      toast(
        "multi-panel layout: not every layer resolved a dataset — showing this layer only",
        "info",
      );
    }
    get().setActive(entry.datasetId);
    // Decoded curve bindings (partial recall, 100% precision) select the
    // actually-plotted channels; without them the default view stands.
    const ds = get().datasets.find((d) => d.id === entry.datasetId);
    const selection = ds ? figureChannelSelection(fig, ds) : null;
    set({
      xLim: [fig.x_from, fig.x_to],
      yLim: [fig.y_from, fig.y_to],
      xLog: fig.x_log,
      yLog: fig.y_log,
      xAxisLabel: fig.x_title ?? "",
      yAxisLabel: fig.y_title ?? "",
      // Pin the figure's decoded floating text; REPLACE, never stack.
      annotations: originFigureAnnotations([fig], entry.id),
      ...(originLegendPos(fig) ? { legendPos: originLegendPos(fig)! } : {}),
      ...(selection
        ? { xKey: selection.xKey, yKeys: selection.yKeys, seriesStyles: selection.styles }
        : {}),
    });
    get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
  },
  // Replace the whole library with a restored workspace (from a .dwk file).
  // Resets every per-dataset view (channels, styles, axis limits) and drops the
  // overlays/markers tied to the old datasets — same hygiene as setActive.
  loadWorkspace: (ws) =>
    set((s) => {
      const { datasets } = ws;
      // Restore the persisted active/selection (v2); v1 or a stale id falls back
      // to the first dataset. Folders + expansion come straight from the doc.
      const active =
        ws.activeId && datasets.some((d) => d.id === ws.activeId)
          ? ws.activeId
          : (datasets[0]?.id ?? null);
      const activeDs = active ? (datasets.find((d) => d.id === active) ?? null) : null;
      const selected = (ws.selectedIds ?? []).filter((id) => datasets.some((d) => d.id === id));
      return {
        datasets,
        folders: ws.folders ?? [],
        expandedFolders: ws.expandedFolders ?? [],
        activeId: active,
        selectedIds: selected.length ? selected : active ? [active] : [],
        originFigures: ws.originFigures ?? [], // restored from the .dwk (v2 persists them)
        reports: ws.reports ?? [], // report sheets (#36) — .dwk v2 persists them
        openReportId: null,
        macroSteps: ws.macroSteps ?? [], // typed pipeline (#6) — .dwk v3
        recalcMode: ws.recalcMode ?? "auto", // recalc engine (#1) — .dwk v3
        figureDocs: ws.figureDocs ?? [], // figure documents (#12) — .dwk v3
        figureDocSeed: null,
        staleDatasets: [],
        staleFits: [],
        stageTab: activeDs ? nextStageTab(activeDs, s.stageTab) : s.stageTab,
        xKey: null,
        yKeys: null,
        y2Keys: null,
      y2Lim: null,
      y2Log: null,
      y2AxisLabel: "",
        seriesStyles: {},
        seriesLabels: {},
        errKeys: activeDs ? defaultErrKeys(activeDs.data) : {},
        seriesOrder: null,
        hiddenChannels: activeDs ? originHiddenChannels(activeDs.data) : [],
        xLim: null,
        yLim: null,
        spatialPanels: null, // decode-plan #36 — never restored from a stale figure apply
        fitOverlay: null,
        peakOverlay: null,
        baselineOverlay: null,
        rsmPeaks: null,
        integral: null,
        fwhmResult: null,
        qfitRoi: null,
        qfitResult: null,
        qfitBusy: false,
        qfitError: null,
        gadgetBusy: false,
        gadgetError: null,
        gadgetIntegrateResult: null,
        gadgetStatsResult: null,
        gadgetDerivResult: null,
        gadgetFftPreview: null,
        gadgetCursors: null,
        gadgetCursorResult: null,
        status: `loaded workspace — ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`,
      };
    }),
  setActive: (id) =>
    set((s) => {
      const ds = s.datasets.find((d) => d.id === id);
      return {
        activeId: id,
        selectedIds: [id], // plain click collapses the selection to this one row
        stageTab: ds ? nextStageTab(ds, s.stageTab) : s.stageTab,
        xKey: null,
        yKeys: null,
        y2Keys: null,
      y2Lim: null,
      y2Log: null,
      y2AxisLabel: "",
        seriesStyles: {},
        seriesLabels: {},
        errKeys: ds ? defaultErrKeys(ds.data) : {},
        seriesOrder: null,
        hiddenChannels: ds ? originHiddenChannels(ds.data) : [],
        xLim: null,
        yLim: null,
        // A plain click on a different dataset always drops a prior spatial
        // multi-panel arrangement (decode-plan #36) — it was built for a
        // specific figure's layers, not whatever is now active.
        spatialPanels: null,
        rsmPeaks: null,
        integral: null,
        fwhmResult: null,
        qfitRoi: null,
        qfitResult: null,
        qfitBusy: false,
        qfitError: null,
        gadgetBusy: false,
        gadgetError: null,
        gadgetIntegrateResult: null,
        gadgetStatsResult: null,
        gadgetDerivResult: null,
        gadgetFftPreview: null,
        gadgetCursors: null,
        gadgetCursorResult: null,
      };
    }),
  // Ctrl/Cmd-click: add or remove a row from the multi-selection WITHOUT changing
  // the plotted/active dataset (the plot only follows a plain click).
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  // Shift-click: select the contiguous range from the anchor (activeId) to `id`
  // in library order. Doesn't move the active selection (the plot stays put).
  selectRange: (id) =>
    set((s) => {
      const order = s.datasets.map((d) => d.id);
      const anchor = s.activeId ?? id;
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      if (a < 0 || b < 0) return { selectedIds: [id] };
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { selectedIds: order.slice(lo, hi + 1) };
    }),
  removeDataset: (id) =>
    set((s) => {
      const datasets = s.datasets.filter((d) => d.id !== id);
      const activeId =
        s.activeId === id ? (datasets[0]?.id ?? null) : s.activeId;
      const selectedIds = s.selectedIds.filter((x) => x !== id);
      const removed = new Set([id]);
      const originFigures = pruneOriginFigureRefs(s.originFigures, removed);
      const reports = pruneReportRefs(s.reports, removed);
      const figureDocs = s.figureDocs.map((f) =>
        f.datasetId && removed.has(f.datasetId) ? { ...f, datasetId: null } : f,
      );
      return { datasets, activeId, selectedIds, originFigures, reports, figureDocs };
    }),
  // Delete key: remove every selected dataset (falling back to the active one if
  // nothing is multi-selected); reselect the first survivor so the plot recovers.
  removeSelected: () =>
    set((s) => {
      const ids = new Set(
        s.selectedIds.length ? s.selectedIds : s.activeId ? [s.activeId] : [],
      );
      if (ids.size === 0) return {};
      const datasets = s.datasets.filter((d) => !ids.has(d.id));
      const activeId =
        s.activeId && !ids.has(s.activeId) ? s.activeId : (datasets[0]?.id ?? null);
      const originFigures = pruneOriginFigureRefs(s.originFigures, ids);
      const reports = pruneReportRefs(s.reports, ids);
      const figureDocs = s.figureDocs.map((f) =>
        f.datasetId && ids.has(f.datasetId) ? { ...f, datasetId: null } : f,
      );
      return {
        datasets,
        activeId,
        selectedIds: activeId ? [activeId] : [],
        originFigures,
        reports,
        figureDocs,
      };
    }),
  // Bulk-remove by explicit id list (item 17's "manage books" dialog) — unlike
  // removeSelected, this doesn't touch/depend on the transient row selection.
  removeDatasets: (ids) =>
    set((s) => {
      if (ids.length === 0) return {};
      const drop = new Set(ids);
      const datasets = s.datasets.filter((d) => !drop.has(d.id));
      const activeId =
        s.activeId && !drop.has(s.activeId) ? s.activeId : (datasets[0]?.id ?? null);
      const selectedIds = s.selectedIds.filter((x) => !drop.has(x));
      const originFigures = pruneOriginFigureRefs(s.originFigures, drop);
      const reports = pruneReportRefs(s.reports, drop);
      const figureDocs = s.figureDocs.map((f) =>
        f.datasetId && drop.has(f.datasetId) ? { ...f, datasetId: null } : f,
      );
      return { datasets, activeId, selectedIds, originFigures, reports, figureDocs };
    }),

  // Wipe the entire library. Reuses loadWorkspace's "replace everything" reset
  // (clears per-dataset view state, overlays, styles, folders, figures) with an
  // empty workspace, so nothing stale survives; autosave self-clears on the
  // resulting empty-datasets state.
  clearAll: () => {
    get().loadWorkspace({
      datasets: [],
      folders: [],
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      reports: [],
      figureDocs: [],
    });
    set({ status: "removed all datasets, folders, figures, and reports" });
  },

  // Concatenate the selected datasets (in selection order) row-wise into one new
  // library dataset. Needs ≥2 with a matching column count (mergeDatasets guards).
  mergeSelected: () => {
    const s = get();
    const picks = s.selectedIds
      .map((id) => s.datasets.find((d) => d.id === id))
      .filter((d): d is Dataset => d != null);
    if (picks.length < 2) {
      get().setStatus("select ≥2 datasets to merge");
      return;
    }
    try {
      const data = mergeDatasets(
        picks.map((d) => d.data),
        picks.map((d) => d.name),
      );
      get().addDataset({ id: nextDatasetId(), name: `merged (${picks.length})`, data });
      get().setStatus(`merged ${picks.length} datasets → ${data.time.length} rows`);
      toast(`merged ${picks.length} datasets`, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "merge failed";
      get().setStatus(msg);
      toast(msg, "danger");
    }
  },

  // Deep-copy a dataset (incl. raw/corrections/bgRef) as an independent "(copy)"
  // — for trying different corrections/formulas while keeping the original.
  // Lands right after the source and becomes active, resetting per-dataset view.
  duplicateDataset: (id) =>
    set((s) => {
      const idx = s.datasets.findIndex((d) => d.id === id);
      if (idx < 0) return {};
      const src = s.datasets[idx];
      const clone: Dataset = {
        id: nextDatasetId(),
        name: `${src.name} (copy)`,
        data: cloneDataStruct(src.data),
        ...(src.raw ? { raw: cloneDataStruct(src.raw) } : {}),
        ...(src.corrections ? { corrections: { ...src.corrections } } : {}),
        ...(src.bgRef ? { bgRef: { ...src.bgRef } } : {}),
        ...(src.notes ? { notes: src.notes } : {}),
        ...(src.tags?.length ? { tags: [...src.tags] } : {}),
        ...(src.group ? { group: src.group } : {}),
        ...(src.formulas?.length ? { formulas: src.formulas.map((f) => ({ ...f })) } : {}),
        ...(src.channelRoles ? { channelRoles: { ...src.channelRoles } } : {}),
        ...(src.channelTypes ? { channelTypes: { ...src.channelTypes } } : {}),
      };
      const datasets = [...s.datasets];
      datasets.splice(idx + 1, 0, clone);
      return {
        datasets,
        activeId: clone.id,
        selectedIds: [clone.id],
        stageTab: nextStageTab(clone, s.stageTab),
        xKey: null,
        yKeys: null,
        y2Keys: null,
      y2Lim: null,
      y2Log: null,
      y2AxisLabel: "",
        seriesStyles: {},
        errKeys: {},
        hiddenChannels: [],
        xLim: null,
        yLim: null,
        spatialPanels: null, // decode-plan #36 — the clone becomes active, not a figure
        rsmPeaks: null,
        integral: null,
        fwhmResult: null,
        qfitRoi: null,
        qfitResult: null,
        qfitBusy: false,
        qfitError: null,
        gadgetBusy: false,
        gadgetError: null,
        gadgetIntegrateResult: null,
        gadgetStatsResult: null,
        gadgetDerivResult: null,
        gadgetFftPreview: null,
        gadgetCursors: null,
        gadgetCursorResult: null,
      };
    }),
  // Reorder the library by swapping a dataset with its neighbor (dir -1 = up,
  // +1 = down). No-op at the ends or for an unknown id. Order drives the list and
  // the consolidated-export column order; the active selection is unaffected.
  moveDataset: (id, dir) =>
    set((s) => {
      const i = s.datasets.findIndex((d) => d.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.datasets.length) return {};
      const datasets = [...s.datasets];
      [datasets[i], datasets[j]] = [datasets[j], datasets[i]];
      return { datasets };
    }),
  renameDataset: (id, name) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, name: name.trim() || d.name } : d,
      ),
    })),
  // Edit a single worksheet cell in place (col < 0 = the x/time column). Rebuilds
  // the dataset's arrays immutably (DataStruct stays frozen-by-contract) so the
  // plot + stats recompute live. Computed columns (the last `formulas.length`)
  // are read-only — a recompute would overwrite them — so an edit there is a
  // no-op. Editing a base cell recomputes the computed columns. Recovery of the
  // original is via Duplicate.
  setCellValue: (id, row, col, value) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    if (col >= baseCount) return; // computed column — read-only
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const data =
          col < 0
            ? { ...d.data, time: d.data.time.map((t, i) => (i === row ? value : t)) }
            : {
                ...d.data,
                values: d.data.values.map((r, i) =>
                  i === row ? r.map((v, c) => (c === col ? value : v)) : r,
                ),
              };
        return recompute({ ...d, data });
      }),
    }));
    get().recordMacro(
      `Edit ${ds.name} [${row},${col}]`,
      `qz.setCell(${lit(ds.name)}, ${row}, ${col}, ${lit(value)})`,
    );
    get().touchDataset(id); // recalc graph (#1): data changed
  },
  // Append a computed column (formula) to a dataset and evaluate it. The column
  // lands as the last column of `data` and recomputes whenever the base changes.
  // Strips the OLD computed columns first, then reapplies the grown list.
  addFormula: (id, name, expr) => {
    const ds = get().datasets.find((d) => d.id === id);
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const base = baseColumns(d.data, d.formulas?.length ?? 0);
        const formulas: ComputedColumn[] = [...(d.formulas ?? []), { name, expr }];
        return { ...d, formulas, data: applyFormulas(base, formulas) };
      }),
    }));
    if (ds) {
      get().recordMacro(`Add column ${name}`, `qz.addColumn(${lit(name)}, ${lit(expr)})`, {
        kind: "expression",
        params: { name, expr },
      });
    }
    get().touchDataset(id); // recalc graph (#1): data changed
  },
  // Remove the computed column at `index` (in the formulas list). Strips the OLD
  // computed columns, then reapplies the shrunk list (NaN-stable indices).
  removeFormula: (id, index) => {
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.formulas) return d;
        const base = baseColumns(d.data, d.formulas.length);
        const formulas = d.formulas.filter((_, i) => i !== index);
        // Computed columns are the LAST formulas.length value columns, in order,
        // so the removed one is column (baseCount + index); every later column
        // shifts down by one. Remap the index-keyed metadata so a role/type/
        // filter set on a later computed column keeps pointing at the right
        // column instead of its shifted neighbour (or a now-nonexistent index).
        const removedCol = base.labels.length + index;
        const remapKeyed = <T,>(rec?: Record<number, T>): Record<number, T> | undefined => {
          if (!rec) return rec;
          const out: Record<number, T> = {};
          for (const [k, v] of Object.entries(rec)) {
            const c = Number(k);
            if (c === removedCol) continue; // the removed column's entry is gone
            out[c > removedCol ? c - 1 : c] = v;
          }
          return Object.keys(out).length ? out : undefined;
        };
        const filter = d.filter
          ?.filter((f) => f.col !== removedCol)
          .map((f) => (f.col > removedCol ? { ...f, col: f.col - 1 } : f));
        return {
          ...d,
          formulas: formulas.length ? formulas : undefined,
          data: applyFormulas(base, formulas),
          channelRoles: remapKeyed(d.channelRoles),
          channelTypes: remapKeyed(d.channelTypes),
          filter: filter && filter.length ? filter : undefined,
        };
      }),
    }));
    get().touchDataset(id); // recalc graph (#1): data changed
  },
  // Attach free-text notes to a dataset (blank clears). Per-dataset, so it lives
  // on the object (round-trips through .dwk) rather than the transient view state.
  setDatasetNotes: (id, notes) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, notes: notes.trim() ? notes : undefined } : d,
      ),
    })),
  // Add a trimmed, de-duplicated tag to a dataset (blank or duplicate = no-op).
  addDatasetTag: (id, tag) =>
    set((s) => {
      const t = tag.trim();
      if (!t) return {};
      return {
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const tags = d.tags ?? [];
          return tags.includes(t) ? d : { ...d, tags: [...tags, t] };
        }),
      };
    }),
  // Remove a tag; the list drops to undefined when it empties (keeps .dwk clean).
  removeDatasetTag: (id, tag) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.tags) return d;
        const tags = d.tags.filter((x) => x !== tag);
        return { ...d, tags: tags.length ? tags : undefined };
      }),
    })),
  // Assign a dataset to a (trimmed) group; blank clears it back to Ungrouped.
  setDatasetGroup: (id, group) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, group: group.trim() ? group.trim() : undefined } : d,
      ),
    })),

  // ── Folder tree (project-organization plan item 1) ──────────────────────
  // All five delegate to the pure lib/foldertree ops; the store only supplies
  // ids and threads state. deleteFolder re-homes datasets (never destroys them).
  createFolder: (parentId, name = "New Folder") => {
    const id = nextFolderId();
    set((s) => ({ folders: treeCreateFolder(s.folders, parentId, name, id) }));
    return id;
  },
  renameFolder: (id, name) => set((s) => ({ folders: treeRenameFolder(s.folders, id, name) })),
  deleteFolder: (id, mode = "reparent") =>
    set((s) => treeDeleteFolder(s.folders, s.datasets, id, mode)),
  moveFolder: (id, newParentId, beforeId) =>
    set((s) => ({ folders: treeMoveFolder(s.folders, id, newParentId, beforeId) })),
  moveDatasetToFolder: (id, folderId, beforeId) =>
    set((s) => ({ datasets: treeMoveDatasetToFolder(s.datasets, id, folderId, beforeId) })),
  toggleFolderExpanded: (id) =>
    set((s) => ({
      expandedFolders: s.expandedFolders.includes(id)
        ? s.expandedFolders.filter((x) => x !== id)
        : [...s.expandedFolders, id],
    })),

  // Corrections always apply to the pristine `raw`, never to an already-
  // corrected `data` (the MATLAB pipeline is replace, not accumulate). The
  // first import becomes `raw`; re-applying with new params re-derives `data`.
  // An optional `bg` picks another loaded dataset as the reference background
  // (step 4 of the pipeline): we forward its CURRENT `data` + the interp method
  // so the golden /api/corrections/apply does the interpolated subtraction.
  applyCorrections: async (id, params, bg) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const raw = ds.raw ?? ds.data;
    // Resolve the background only if it points at a real, different dataset.
    const bgDs =
      bg && bg.datasetId !== id
        ? get().datasets.find((d) => d.id === bg.datasetId)
        : undefined;
    const bgRef = bgDs ? { datasetId: bgDs.id, interp: bg!.interp } : undefined;
    const req: CorrectionsRequest = { dataset: raw, params };
    if (bgDs) {
      req.bg_dataset = bgDs.data;
      req.bg_interp = bg!.interp;
    }
    try {
      const corrected = await applyCorrectionsApi(req);
      // excludedRows are raw row INDICES into ds.data; an xTrim shrinks/shifts
      // the rows (corrections.py step 1), so carrying stale indices forward would
      // exclude the WRONG rows (or silently lose the exclusion). Drop them when
      // the row count changes rather than corrupt the analysis view.
      const rowsChanged = corrected.time.length !== ds.data.time.length;
      // Recompute any computed columns from the freshly-corrected base.
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id
            ? recompute({
                ...d,
                data: corrected,
                raw,
                corrections: params,
                bgRef,
                ...(rowsChanged ? { excludedRows: undefined } : {}),
              })
            : d,
        ),
      }));
      if (rowsChanged && ds.excludedRows?.length) {
        get().setStatus(
          "Row exclusions cleared: a trim changed the row count, so the saved row indices no longer apply.",
        );
      }
      get().recordMacro(
        `Corrections → ${ds.name}`,
        bgDs
          ? `qz.applyCorrections(${lit(ds.name)}, ${lit(params)}, ${lit({ bg: bgDs.name, interp: bg!.interp })})`
          : `qz.applyCorrections(${lit(ds.name)}, ${lit(params)})`,
        { kind: "correction", params: { params, bg } },
      );
      get().touchDataset(id); // recalc graph (#1): data changed
    } catch (e) {
      get().setStatus(
        `corrections failed: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  },
  resetCorrections: (id) => {
    const ds = get().datasets.find((d) => d.id === id);
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.raw) return d;
        // Reverting a trim restores rows, so index-based excludedRows are stale.
        const rowsChanged = d.raw.time.length !== d.data.time.length;
        return recompute({
          ...d,
          data: d.raw,
          raw: undefined,
          corrections: undefined,
          bgRef: undefined,
          ...(rowsChanged ? { excludedRows: undefined } : {}),
        });
      }),
    }));
    if (ds?.raw) {
      get().recordMacro(`Reset corrections → ${ds.name}`, `qz.resetCorrections(${lit(ds.name)})`, {
        kind: "reset",
        params: {},
      });
    }
    get().touchDataset(id); // recalc graph (#1): data changed
  },
  // Propagate one dataset's corrections to a batch. Each target re-derives from
  // its OWN raw (applyCorrections is replace-not-accumulate), so this is safe to
  // run repeatedly. The same bg-reference dataset is reused for all targets.
  applyCorrectionsToMany: async (sourceId, targetIds) => {
    const src = get().datasets.find((d) => d.id === sourceId);
    if (!src?.corrections) {
      get().setStatus("no corrections on the source dataset to copy");
      return;
    }
    const bg = src.bgRef ? { datasetId: src.bgRef.datasetId, interp: src.bgRef.interp } : undefined;
    let n = 0;
    for (const id of targetIds) {
      if (id === sourceId) continue;
      // Don't subtract a dataset from itself if it's the shared bg reference.
      const useBg = bg && bg.datasetId !== id ? bg : undefined;
      await get().applyCorrections(id, src.corrections, useBg);
      n += 1;
    }
    get().setStatus(`applied ${src.name}'s corrections to ${n} dataset${n === 1 ? "" : "s"}`);
  },
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setStageTab: (stageTab) => set({ stageTab }),
  setTheme: (theme) => {
    set({ theme });
    syncPrefs(get());
  },
  setAccent: (accent) => {
    set({ accent });
    syncPrefs(get());
  },
  setDensity: (density) => {
    set({ density });
    syncPrefs(get());
  },
  setPalette: (palette) => {
    set({ palette });
    syncPrefs(get());
  },
  setPref: (key, value) => {
    set({ [key]: value } as Partial<AppState>);
    syncPrefs(get());
  },
  setPrefsOpen: (prefsOpen) => set({ prefsOpen }),
  setYLog: (yLog) => {
    set({ yLog });
    get().recordMacro(`Y axis ${yLog ? "log" : "linear"}`, `qz.setYLog(${yLog})`);
  },
  setXLog: (xLog) => {
    set({ xLog });
    get().recordMacro(`X axis ${xLog ? "log" : "linear"}`, `qz.setXLog(${xLog})`);
  },
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowLegend: (showLegend) => set({ showLegend }),
  setLegendPos: (legendPos) => set({ legendPos }),
  setPlotTemplate: (plotTemplate) => set({ plotTemplate }),
  setShowAxisBox: (showAxisBox) => set({ showAxisBox }),
  // A manual toggle (on OR off) always drops any spatial arrangement from a
  // prior Origin multi-panel apply — the plain per-channel split (or leaving
  // stack mode) is what the user asked for, never a stale spatial grid.
  setStackMode: (stackMode) => set({ stackMode, spatialPanels: null }),
  setInsetMode: (insetMode) => set({ insetMode }),
  setPolarMode: (polarMode) => set({ polarMode }),
  setStatMode: (statMode) => set({ statMode }),
  setXLim: (xLim) => set({ xLim }),
  setYLim: (yLim) => set({ yLim }),
  setXFmt: (xFmt) => set({ xFmt }),
  setYFmt: (yFmt) => set({ yFmt }),
  setPlotTitle: (plotTitle) => {
    set({ plotTitle });
    get().recordMacro(`Title → ${plotTitle || "(none)"}`, `qz.setPlotTitle(${lit(plotTitle)})`);
  },
  setXAxisLabel: (xAxisLabel) => set({ xAxisLabel }),
  setYAxisLabel: (yAxisLabel) => set({ yAxisLabel }),
  setY2AxisLabel: (y2AxisLabel) => set({ y2AxisLabel }),
  setXKey: (xKey) => {
    set({ xKey });
    get().recordMacro(`X axis → channel ${xKey ?? "time"}`, `qz.setXKey(${lit(xKey)})`);
  },
  setYKeys: (yKeys) => {
    set({ yKeys });
    get().recordMacro(`Y channels → ${yKeys ? yKeys.join(",") : "all"}`, `qz.setYKeys(${lit(yKeys)})`);
  },
  setY2Keys: (y2Keys) => {
    set({ y2Keys, ...(y2Keys ? {} : { y2Lim: null, y2Log: null, y2AxisLabel: "" }) });
    get().recordMacro(
      `Y2 channels → ${y2Keys ? y2Keys.join(",") : "none"}`,
      `qz.setY2Keys(${lit(y2Keys)})`,
    );
  },
  addRefLine: (axis, value) =>
    set((s) => ({ refLines: [...s.refLines, { id: `ref-${++_refSeq}`, axis, value }] })),
  removeRefLine: (id) => set((s) => ({ refLines: s.refLines.filter((r) => r.id !== id) })),
  // Move a reference line to a new value (drag commit). No-op for an unknown id.
  updateRefLine: (id, value) =>
    set((s) => ({ refLines: s.refLines.map((r) => (r.id === id ? { ...r, value } : r)) })),
  addAnnotation: (x, y, text) =>
    set((s) => ({
      annotations: [...s.annotations, { id: `ann-${++_annSeq}`, x, y, text }],
    })),
  removeAnnotation: (id) =>
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
  setSeriesStyle: (channel, patch) =>
    set((s) => ({
      seriesStyles: { ...s.seriesStyles, [channel]: { ...s.seriesStyles[channel], ...patch } },
    })),
  resetSeriesStyle: (channel) =>
    set((s) => {
      const next = { ...s.seriesStyles };
      delete next[channel];
      return { seriesStyles: next };
    }),
  // Rename a channel's legend/series label. Blank (or whitespace) clears the
  // override, reverting to the dataset's own label.
  setSeriesLabel: (channel, label) =>
    set((s) => {
      const next = { ...s.seriesLabels };
      const t = label.trim();
      if (t) next[channel] = t;
      else delete next[channel];
      return { seriesLabels: next };
    }),
  setErrKey: (channel, errChannel) =>
    set((s) => {
      const next = { ...s.errKeys };
      if (errChannel == null) delete next[channel];
      else next[channel] = errChannel;
      return { errKeys: next };
    }),
  // Set (or clear, role=null) a column role on the ACTIVE dataset. Roles live on
  // the dataset (persist across switches + round-trip .dwk); the map empties to
  // undefined to keep saved files clean.
  setChannelRole: (channel, role) => {
    const id = get().activeId;
    if (id == null) return;
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const next = { ...(d.channelRoles ?? {}) };
        if (role == null) delete next[channel];
        else next[channel] = role;
        return { ...d, channelRoles: Object.keys(next).length ? next : undefined };
      }),
    }));
    get().recordMacro(
      `Channel ${channel} role → ${role ?? "data"}`,
      `qz.setChannelRole(${channel}, ${lit(role)})`,
    );
  },
  // Set (or clear, t=null) a modeling-type OVERRIDE on the ACTIVE dataset.
  // Mirrors setChannelRole: overrides live on the dataset (persist across
  // switches + round-trip .dwk); absent = auto-inference (lib/modeling).
  setChannelType: (channel, t) => {
    const id = get().activeId;
    if (id == null) return;
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const next = { ...(d.channelTypes ?? {}) };
        if (t == null) delete next[channel];
        else next[channel] = t;
        return { ...d, channelTypes: Object.keys(next).length ? next : undefined };
      }),
    }));
    get().recordMacro(
      `Channel ${channel} type → ${t ?? "auto"}`,
      `qz.setChannelType(${channel}, ${lit(t)})`,
    );
  },
  // Row state (#50): the single source of truth for per-row exclusion. Excluded
  // rows persist on the dataset (round-trip .dwk) so every view can honor them —
  // no view should keep its own local row mask.
  toggleRowExcluded: (id, row) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const next = toggleExcluded(d.excludedRows, row);
        return { ...d, excludedRows: next.length ? next : undefined };
      }),
    })),
  setRowsExcluded: (id, rows) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const clean = sanitizeExcluded(rows, d.data.time.length);
        return { ...d, excludedRows: clean.length ? clean : undefined };
      }),
    })),
  clearRowExclusions: (id) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, excludedRows: undefined } : d,
      ),
    })),
  setDatasetFilter: (id, filter) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const active = filter.filter(isActive);
        return { ...d, filter: active.length ? active : undefined };
      }),
    })),
  clearDatasetFilter: (id) =>
    set((s) => ({
      datasets: s.datasets.map((d) => (d.id === id ? { ...d, filter: undefined } : d)),
    })),
  toggleRowSelected: (row) => {
    const id = get().activeId;
    if (id == null) return;
    set((s) => {
      const cur = s.selection?.datasetId === id ? s.selection.rows : [];
      const rows = cur.includes(row)
        ? cur.filter((r) => r !== row)
        : [...cur, row].sort((a, b) => a - b);
      return { selection: rows.length ? { datasetId: id, rows } : null };
    });
  },
  setRowSelection: (rows) => {
    const id = get().activeId;
    if (id == null) return;
    const clean = [...new Set(rows)].sort((a, b) => a - b);
    set({ selection: clean.length ? { datasetId: id, rows: clean } : null });
  },
  clearRowSelection: () => set({ selection: null }),
  excludeSelectedRows: () => {
    const id = get().activeId;
    const sel = get().selection;
    if (id == null || sel?.datasetId !== id || !sel.rows.length) return;
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const merged = [...new Set([...(d.excludedRows ?? []), ...sel.rows])].sort((a, b) => a - b);
        return { ...d, excludedRows: merged };
      }),
      selection: null,
    }));
  },
  keepOnlySelectedRows: () => {
    const id = get().activeId;
    const sel = get().selection;
    if (id == null || sel?.datasetId !== id || !sel.rows.length) return;
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const keep = new Set(sel.rows);
        const excluded: number[] = [];
        for (let r = 0; r < d.data.time.length; r++) if (!keep.has(r)) excluded.push(r);
        return { ...d, excludedRows: excluded.length ? excluded : undefined };
      }),
      selection: null,
    }));
  },
  // Persist an explicit plotted-channel draw order (a permutation of the current
  // plotted channels). effectiveChannels reorders by it; stale entries (channels
  // no longer plotted) are ignored and newly-plotted channels append in order.
  setSeriesOrder: (seriesOrder) => set({ seriesOrder }),
  toggleHidden: (channel) =>
    set((s) => ({
      hiddenChannels: s.hiddenChannels.includes(channel)
        ? s.hiddenChannels.filter((c) => c !== channel)
        : [...s.hiddenChannels, channel],
    })),
  // Solo = hide every plotted channel except `channel` (the column switcher's
  // engine). null clears. View state like toggleHidden — not macro-recorded.
  soloChannel: (channel) =>
    set((s) => {
      if (channel == null) return { hiddenChannels: [] };
      const ds = s.datasets.find((d) => d.id === s.activeId);
      if (!ds) return {};
      const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
      if (!plotted.includes(channel)) return {};
      return { hiddenChannels: plotted.filter((c) => c !== channel) };
    }),
  setWaterfall: (waterfall) => {
    set({ waterfall });
    get().recordMacro(`Waterfall → ${waterfall}`, `qz.setWaterfall(${waterfall})`);
  },
  setPlotTool: (plotTool) => set({ plotTool }),
  setRegionPicked: (regionPicked) => set({ regionPicked }),
  setIntegral: (integral) => set({ integral }),
  setFwhmResult: (fwhmResult) => set({ fwhmResult }),
  // ── Quick-fit gadget (#33) ────────────────────────────────────────────────
  setQfitRoi: (roi) => {
    set({ qfitRoi: roi });
    if (_qfitTimer) {
      clearTimeout(_qfitTimer);
      _qfitTimer = null;
    }
    if (!roi) {
      // A cleared ROI (sub-6px click, or an explicit clear) drops every
      // region-mode's result + chip; only null the shared fit/deriv overlay if
      // THIS gadget set it (a result was ever produced) — never clobber an
      // unrelated overlay (e.g. the Curve Fit workshop's own fitOverlay) just
      // because the tool was touched.
      set((s) => ({
        qfitResult: null,
        qfitBusy: false,
        qfitError: null,
        fitOverlay: s.qfitResult != null ? null : s.fitOverlay,
        gadgetBusy: false,
        gadgetError: null,
        gadgetIntegrateResult: null,
        gadgetStatsResult: null,
        gadgetDerivResult: null,
        derivOverlay: s.gadgetDerivResult != null ? null : s.derivOverlay,
        gadgetFftPreview: null,
      }));
      return;
    }
    // Debounced: a burst of drag-move events triggers ONE compute request.
    _qfitTimer = setTimeout(() => {
      _qfitTimer = null;
      void get().runGadget();
    }, 350);
  },
  setQfitModel: (qfitModel) => {
    set({ qfitModel });
    // Switching model while an ROI is active refits it (debounced, like a move).
    if (get().qfitRoi) get().setQfitRoi(get().qfitRoi);
  },
  runQuickFit: async () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active || !s.qfitRoi) return;
    const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
    const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
    const sel = selectRoiRows(active, s.qfitRoi, col);
    if (sel.x.length < 2) {
      set({ qfitError: "not enough points in the selected region", qfitBusy: false });
      return;
    }
    set({ qfitBusy: true, qfitError: null });
    try {
      const r = await fitModel({ model: s.qfitModel, x: sel.x, y: sel.y });
      // Guard a stale response: the gadget may have been cleared, or the
      // active dataset switched, while the request was in flight.
      const cur = get();
      if (cur.activeId !== active.id || !cur.qfitRoi) return;
      set({ qfitResult: r, qfitBusy: false });
      const yFit = r.yFit as (number | null)[] | undefined;
      if (Array.isArray(yFit)) {
        // yFit aligns to the ROI-sliced rows; expand back to the full row
        // count (null outside the ROI / excluded / filtered) so it overlays
        // the full-length plot x in register — the expandToFull pattern
        // useCurveFit uses for the whole-dataset case (rowstate.ts).
        const y = expandToFull(yFit, sel.rows, active.data.time.length);
        set({ fitOverlay: { datasetId: active.id, y } });
      }
    } catch (e) {
      set({ qfitBusy: false, qfitError: e instanceof Error ? e.message : "fit failed" });
    }
  },
  commitQfit: () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active || !s.qfitResult) return;
    // Recorded like the Curve Fit workshop's own commit (lib/pipeline "fit"
    // step) so the pipeline view can edit/replay it identically.
    get().recordMacro(`Fit ${s.qfitModel}`, `qz.fit(${lit(s.qfitModel)})`, {
      kind: "fit",
      params: { model: s.qfitModel },
    });
    // Durable fit spec: the recalc graph (#1) re-runs / stales this fit over
    // the dataset's full analysis view when the data changes — the gadget's
    // ROI only shaped which model + starting rows the user previewed with.
    get().setFitSpec(active.id, { model: s.qfitModel });
  },
  // ── ROI gadget family (#34) — generalizes the frame above ─────────────────
  // Mode switch: re-triggers a live ROI's compute for the new mode (mirrors
  // setQfitModel), and swaps between the ROI-band interaction and the
  // cursors interaction (they're mutually exclusive — only one is armed).
  setGadgetMode: (mode) => {
    const prev = get().gadgetMode;
    if (prev === mode) return;
    set({ gadgetMode: mode });
    if (mode === "cursors") {
      if (get().qfitRoi) get().setQfitRoi(null);
      return;
    }
    if (prev === "cursors" && get().gadgetCursors) get().setGadgetCursors(null);
    if (get().qfitRoi) get().setQfitRoi(get().qfitRoi);
  },
  runGadget: async () => {
    switch (get().gadgetMode) {
      case "fit":
        return get().runQuickFit();
      case "integrate":
        return get().runGadgetIntegrate();
      case "stats":
        return get().runGadgetStats();
      case "differentiate":
        return get().runGadgetDifferentiate();
      case "fft":
        return get().runGadgetFft();
      case "cursors":
        return; // cursors don't ride the ROI-band debounce path
    }
  },
  runGadgetIntegrate: async () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active || !s.qfitRoi) return;
    const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
    const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
    const sel = selectRoiRows(active, s.qfitRoi, col);
    if (sel.x.length < 2) {
      set({ gadgetError: "not enough points in the selected region", gadgetBusy: false, gadgetIntegrateResult: null });
      return;
    }
    const lo = Math.min(s.qfitRoi[0], s.qfitRoi[1]);
    const hi = Math.max(s.qfitRoi[0], s.qfitRoi[1]);
    set({ gadgetBusy: true, gadgetError: null });
    try {
      const r = await peaksIntegrate({ x: sel.x, y: sel.y, regions: [[lo, hi]], baseline: "linear" });
      const cur = get();
      if (cur.activeId !== active.id || !cur.qfitRoi) return;
      set({ gadgetIntegrateResult: r, gadgetBusy: false });
    } catch (e) {
      set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : "integrate failed" });
    }
  },
  runGadgetStats: async () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active || !s.qfitRoi) return;
    const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
    const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
    const sel = selectRoiRows(active, s.qfitRoi, col);
    if (sel.y.length < 1) {
      set({ gadgetError: "not enough points in the selected region", gadgetBusy: false, gadgetStatsResult: null });
      return;
    }
    set({ gadgetBusy: true, gadgetError: null });
    try {
      const r = await statsDescriptive(sel.y);
      const cur = get();
      if (cur.activeId !== active.id || !cur.qfitRoi) return;
      set({ gadgetStatsResult: r, gadgetBusy: false });
    } catch (e) {
      set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : "stats failed" });
    }
  },
  // Synchronous (client-side central differences) — no busy state, but shares
  // `gadgetError` with the async modes for a consistent chip error slot.
  runGadgetDifferentiate: () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active || !s.qfitRoi) return;
    const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
    const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
    const sel = selectRoiRows(active, s.qfitRoi, col);
    const result = centralDifference(sel.x, sel.y);
    if (!result) {
      set({ gadgetError: "not enough points in the selected region", gadgetDerivResult: null, derivOverlay: null });
      return;
    }
    set({ gadgetError: null, gadgetDerivResult: result });
    const y = expandToFull(result.dydx, sel.rows, active.data.time.length);
    set({ derivOverlay: { datasetId: active.id, y } });
  },
  runGadgetFft: async () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active || !s.qfitRoi) return;
    const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
    const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
    const sel = selectRoiRows(active, s.qfitRoi, col);
    if (sel.x.length < 4) {
      set({ gadgetError: "need at least 4 points in the selected region", gadgetBusy: false, gadgetFftPreview: null });
      return;
    }
    // FFT assumes evenly-sampled, ascending x (fs = 1/mean(diff(x))); ROI rows
    // arrive in acquisition order, which may not be monotonic (loops/swept-
    // back scans) — sort before sending (same discipline as differentiate).
    const sorted = sortByX(sel.x, sel.y);
    set({ gadgetBusy: true, gadgetError: null });
    try {
      const r = await fftSpectral({ x: sorted.x, y: sorted.y });
      const cur = get();
      if (cur.activeId !== active.id || !cur.qfitRoi) return;
      set({ gadgetFftPreview: r, gadgetBusy: false });
    } catch (e) {
      set({ gadgetBusy: false, gadgetError: e instanceof Error ? e.message : "FFT failed" });
    }
  },
  // Ending action for FFT mode: the live preview becomes a new library dataset
  // (there's no fitSpec-like durable slot for a spectrum) — mirrors "Commit"
  // for the other modes, but adds to the library instead of writing a spec.
  commitGadgetFft: () => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    const r = s.gadgetFftPreview;
    if (!active || !r) return;
    const freq = Array.isArray(r.freq) ? r.freq : [];
    const magRaw = (r.magnitude ?? r.psd ?? r.phase) as (number | null)[] | undefined;
    const mag = Array.isArray(magRaw) ? magRaw : [];
    const label = r.magnitude ? "magnitude" : r.psd ? "psd" : "phase";
    const data: DataStruct = {
      time: freq,
      values: mag.map((v) => [v ?? Number.NaN]),
      labels: [label],
      units: [""],
      metadata: { source: "fft gadget", sourceDataset: active.name, window: r.windowName },
    };
    get().addDataset({ id: nextDatasetId(), name: `${active.name} — FFT`, data });
    get().setStatus("FFT spectrum added to library");
    toast("FFT spectrum added to library", "ok");
  },
  // Paired-cursors mode: recomputed synchronously on every placement/drag
  // (cheap nearest-sample math, not an API call) against the FULL first
  // plotted channel — cursors aren't ROI-scoped.
  setGadgetCursors: (gadgetCursors) => {
    set({ gadgetCursors });
    if (!gadgetCursors) {
      set({ gadgetCursorResult: null });
      return;
    }
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    if (!active) {
      set({ gadgetCursorResult: null });
      return;
    }
    const plotted = effectiveChannels(active.data, s.yKeys, s.xKey, active.channelRoles, s.seriesOrder);
    const col = firstVisiblePlottedChannel(plotted, (c) => s.hiddenChannels.includes(c));
    const sel = selectRoiRows(active, [-Infinity, Infinity], col);
    set({ gadgetCursorResult: computeCursorReadout(sel.x, sel.y, gadgetCursors) });
  },
  clearQfit: () => {
    get().setQfitRoi(null);
    get().setGadgetCursors(null);
  },
  setCmdk: (cmdkOpen) => set({ cmdkOpen }),
  setCurveFitOpen: (curveFitOpen) => set({ curveFitOpen }),
  setHysteresisOpen: (hysteresisOpen) => set({ hysteresisOpen }),
  setPeaksOpen: (peaksOpen) => set({ peaksOpen }),
  setReflectivityOpen: (reflectivityOpen) => set({ reflectivityOpen }),
  seedReflectivityLayer: (reflectivitySeed) => set({ reflectivitySeed, reflectivityOpen: true }),
  clearReflectivitySeed: () => set({ reflectivitySeed: null }),
  setBaselineOpen: (baselineOpen) => set({ baselineOpen }),
  setCalculatorsOpen: (calculatorsOpen) => set({ calculatorsOpen }),
  setRsmOpen: (rsmOpen) => set({ rsmOpen }),
  setDigitizerOpen: (digitizerOpen) => set({ digitizerOpen }),
  setDatasetMathOpen: (datasetMathOpen) => set({ datasetMathOpen }),
  setTabulateOpen: (tabulateOpen) => set({ tabulateOpen }),
  setDistributionOpen: (distributionOpen) => set({ distributionOpen }),
  setStatsChooserOpen: (statsChooserOpen) => set({ statsChooserOpen }),
  setPeakWizardOpen: (peakWizardOpen) => set({ peakWizardOpen }),
  setImportWizardOpen: (importWizardOpen) => set({ importWizardOpen }),
  setPipelineOpen: (pipelineOpen) => set({ pipelineOpen }),
  // Report sheets (#36). Adding opens the viewer on the new report so the
  // producing workshop's "→ Report" lands somewhere visible immediately.
  addReport: (name, report, datasetId) =>
    set((s) => {
      const entry: ReportEntry = {
        id: nextReportId(),
        name,
        datasetId: datasetId ?? null,
        report,
      };
      return {
        reports: [...s.reports, entry],
        openReportId: entry.id,
        status: `report "${name}" created`,
      };
    }),
  removeReport: (id) =>
    set((s) => ({
      reports: s.reports.filter((r) => r.id !== id),
      openReportId: s.openReportId === id ? null : s.openReportId,
    })),
  renameReport: (id, name) =>
    set((s) => ({
      reports: s.reports.map((r) => (r.id === id ? { ...r, name } : r)),
    })),
  setOpenReport: (openReportId) => set({ openReportId }),
  // ── Figure documents (#12) ──────────────────────────────────────────────
  addFigureDoc: (doc) =>
    set((s) => ({
      figureDocs: [...s.figureDocs, doc],
      status: `figure "${doc.name}" saved`,
    })),
  removeFigureDoc: (id) =>
    set((s) => ({ figureDocs: s.figureDocs.filter((f) => f.id !== id) })),
  renameFigureDoc: (id, name) =>
    set((s) => ({
      figureDocs: s.figureDocs.map((f) => (f.id === id ? { ...f, name } : f)),
    })),
  duplicateFigureDoc: (id) =>
    set((s) => {
      const src = s.figureDocs.find((f) => f.id === id);
      if (!src) return {};
      const copy: FigureDoc = {
        ...src,
        id: `figd-${Date.now().toString(36)}-${++_idSeq}`,
        name: `${src.name} copy`,
      };
      return { figureDocs: [...s.figureDocs, copy] };
    }),
  // Open = activate the doc's dataset and hand the config to the builder.
  openFigureDoc: (id) => {
    const doc = get().figureDocs.find((f) => f.id === id);
    if (!doc || !docRenderable(doc)) return;
    if (doc.live && doc.datasetId) get().setActive(doc.datasetId);
    set({ figureDocSeed: doc, figureBuilderOpen: true });
  },
  clearFigureDocSeed: () => set({ figureDocSeed: null }),
  // ── Recalc engine (#1) ───────────────────────────────────────────────────
  setRecalcMode: (recalcMode) => set({ recalcMode }),
  touchDataset: (id) => {
    if (_recalcInProgress) return; // the recalc's own writes never re-mark
    const s = get();
    if (s.recalcMode === "off") return;
    const down = downstreamOf(s.datasets, id);
    const staleDatasets = markStale(s.staleDatasets, down.datasets);
    const staleFits = markStale(s.staleFits, down.fits);
    if (staleDatasets !== s.staleDatasets || staleFits !== s.staleFits) {
      set({ staleDatasets, staleFits });
    }
    if (s.recalcMode === "auto" && (staleDatasets.length || staleFits.length)) {
      // Debounced: a burst of cell edits triggers ONE downstream pass.
      if (_recalcTimer) clearTimeout(_recalcTimer);
      _recalcTimer = setTimeout(() => {
        _recalcTimer = null;
        void get().recalcNow();
      }, 400);
    }
  },
  recalcNow: async () => {
    if (_recalcInProgress) return;
    _recalcInProgress = true;
    try {
      // Corrections first (they change the data fits consume), then fits.
      for (const id of [...get().staleDatasets]) {
        const d = get().datasets.find((x) => x.id === id);
        if (d?.corrections && d.raw) {
          try {
            await get().applyCorrections(id, d.corrections, d.bgRef);
            set((s) => ({ staleDatasets: s.staleDatasets.filter((x) => x !== id) }));
          } catch {
            /* stays stale; applyCorrections already surfaced the error */
          }
        } else {
          set((s) => ({ staleDatasets: s.staleDatasets.filter((x) => x !== id) }));
        }
      }
      for (const id of [...get().staleFits]) {
        const d = get().datasets.find((x) => x.id === id);
        if (!d?.fitSpec) {
          set((s) => ({ staleFits: s.staleFits.filter((x) => x !== id) }));
          continue;
        }
        try {
          const ad = analysisData(d);
          if (!ad || ad.values.length === 0) throw new Error("no data");
          const r = await fitModel({
            model: d.fitSpec.model,
            x: ad.time,
            y: ad.values.map((row) => row[0]),
          });
          const yFit = r.yFit as (number | null)[] | undefined;
          // Refresh the overlay only if this dataset's fit is the one shown.
          if (Array.isArray(yFit) && get().fitOverlay?.datasetId === id) {
            const n = d.data.time.length;
            const kept = activeRowIndices(n, droppedRows(d));
            const y = kept.length === n ? yFit : expandToFull(yFit, kept, n);
            set({ fitOverlay: { datasetId: id, y } });
          }
          set((s) => ({ staleFits: s.staleFits.filter((x) => x !== id) }));
        } catch (e) {
          get().setStatus(
            `recalc fit failed: ${e instanceof Error ? e.message : "error"}`,
          );
        }
      }
    } finally {
      _recalcInProgress = false;
    }
  },
  setFitSpec: (id, spec) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, fitSpec: spec ?? undefined } : d,
      ),
    })),
  setDataFilterOpen: (dataFilterOpen) => set({ dataFilterOpen }),
  setFigureBuilderOpen: (figureBuilderOpen) => set({ figureBuilderOpen }),
  setGraphBuilderOpen: (graphBuilderOpen) => set({ graphBuilderOpen }),
  seedStatStage: (statStageSeed) => set({ statStageSeed, statMode: true }),
  clearStatStageSeed: () => set({ statStageSeed: null }),
  setWaterfallOpen: (waterfallOpen) => set({ waterfallOpen }),
  setReflViewOpen: (reflViewOpen) => set({ reflViewOpen }),
  setColumnSwitcherOpen: (columnSwitcherOpen) => set({ columnSwitcherOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  pushRecent: (name, size) =>
    set((s) => {
      const next = addRecentEntry(s.recent, { name, size, at: new Date().toISOString() });
      saveRecent(next);
      return { recent: next };
    }),
  clearRecent: () => {
    clearRecentMeta();
    set({ recent: [] });
  },
  setMagToolsOpen: (magToolsOpen) => set({ magToolsOpen }),
  setFitOverlay: (fitOverlay) => set({ fitOverlay }),
  setPeakOverlay: (peakOverlay) => set({ peakOverlay }),
  setBaselineOverlay: (baselineOverlay) => set({ baselineOverlay }),
  setRsmPeaks: (rsmPeaks) => set({ rsmPeaks }),
  setMapMethod: (mapMethod) => set({ mapMethod }),
  setMapRes: (mapRes) => set({ mapRes }),
  setContourOn: (contourOn) => set({ contourOn }),
  setContourLevelCount: (n) => set({ contourLevelCount: Math.max(2, Math.round(n)) }),
  setContourScale: (contourScale) => set({ contourScale }),
  // ── Macro recorder ──────────────────────────────────────────────────────
  startMacro: () => set({ macroRecording: true }),
  stopMacro: () => set({ macroRecording: false }),
  clearMacro: () => set({ macroSteps: [], macroRecording: false }),
  recordMacro: (label, code, typed) =>
    set((s) =>
      s.macroRecording && !s.pipelineRunning
        ? {
            macroSteps: [
              ...s.macroSteps,
              makeStep(typed?.kind ?? "ui", label, code, typed?.params ?? {}),
            ],
          }
        : {},
    ),
  // ── Pipeline view (#6): edit + replay the recorded step list ────────────
  updateStepParams: (id, params) =>
    set((s) => ({
      macroSteps: s.macroSteps.map((st) =>
        st.id === id ? regenerateStep({ ...st, params }) : st,
      ),
    })),
  toggleStep: (id) =>
    set((s) => ({
      macroSteps: s.macroSteps.map((st) =>
        st.id === id ? { ...st, enabled: !st.enabled } : st,
      ),
    })),
  removeStep: (id) =>
    set((s) => ({ macroSteps: s.macroSteps.filter((st) => st.id !== id) })),
  moveStep: (id, delta) =>
    set((s) => {
      const i = s.macroSteps.findIndex((st) => st.id === id);
      return i < 0 ? {} : { macroSteps: movePipelineStep(s.macroSteps, i, delta) };
    }),
  insertStep: (step) => set((s) => ({ macroSteps: [...s.macroSteps, step] })),
  loadSteps: (macroSteps) => set({ macroSteps }),
  setPipelineRunning: (pipelineRunning) => set({ pipelineRunning }),
  setStatus: (status) => set({ status }),
}));

// Apply the persisted prefs to <html> + the number formatter on load (set* only
// ran on change, so without this the first paint had no theme/accent/density/
// reduce-motion attributes and the formatter used its compiled defaults).
syncPrefs(useApp.getState());

/** Convenience selector: the currently active dataset (or null). */
export function useActiveDataset(): Dataset | null {
  return useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
}
