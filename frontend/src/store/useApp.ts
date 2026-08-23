// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.
import { create } from "zustand";
import type { FftSpectralResult, IntegrateResponse } from "../lib/api";
import { statsDescriptive } from "../lib/api/statsDescriptive";
import { fftSpectral, fitModel, peaksIntegrate, uploadFile } from "../lib/api";
import { cloneDataStruct } from "../lib/dataset";
import { centralDifference, sortByX, type DerivativeResult } from "../lib/differentiate";
import { computeCursorReadout } from "../lib/gadgetCursors";
import type { Measurement } from "../lib/measure";
import { defaultErrKeys, originHiddenChannels } from "../lib/errorbars";
import type { Notation } from "../lib/format";
import { recomputeWithErrors } from "../lib/formula";
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
  migrateGroupsToFolders,
  moveDatasetToFolder as treeMoveDatasetToFolder,
  moveFolder as treeMoveFolder,
  renameFolder as treeRenameFolder,
} from "../lib/foldertree";
import { isOriginBookDataset } from "../lib/grouping";
import { mergeDatasets } from "../lib/merge";
import type { SmartFolder } from "../lib/smartfolders";
import type { LoadedWorkspace, WorkspaceState } from "../lib/workspace";
import { sanitizeVisibleDetailsColumns } from "../lib/libraryDetailsColumns";
import type { WorkbookNode } from "../lib/workbooks";
import { sanitizeTechniqueViewMemory } from "../lib/techniqueViewMemory";
import {
  doubleYPartner,
  figureChannelSelection,
  figureLabel,
  figureLayerFamily,
  figureSelectionState,
  originFigureAnnotations,
  originLegendState,
  originRegionShades,
  resolveSpatialPanels,
  spatialApplyNotices,
} from "../lib/originFigures";
import {
  dedupeWindowTitle,
  displayedWindowTitle,
  hydrateView,
  scaleFromLog, snapshotView,
} from "../lib/plotview";
import { sanitizeDocumentBackedPlotWindows } from "../lib/windowDocumentPersistence";
import { nextStageTab, plotIntentStageTab, type StageTab } from "../lib/stagetab";
// The MDI window-management slice (MAIN_PLAN #2): state + actions live in
// ./windows and are composed into THIS store instance below; the shared
// rebind helpers are imported back for setActive/addDataset/loadWorkspace.
import {
  createWindowsSlice,
  datasetViewDefaults,
  focusedRebindPatch,
  focusTransientReset,
  mainWindow,
  retargetPassiveRebind,
  type WindowsSlice,
} from "./windows";
import { rebindFocusedPlotWindow, withWindowDocumentErrors } from "./windowDocuments";
// Composed store slices (each documented in its own file) + workspace IO:
import { createHistorySlice, type HistoryBatchToken, type HistorySlice } from "./history";
import { createWorksheetSelectionSlice, type WorksheetSelectionSlice } from "./worksheetSelection";
import { runAppendWorkspace, runSaveWorkspace, runSaveWorkspaceToFile } from "./workspaceIO";
import { createReductionsSlice, type ReductionsSlice } from "./reductions";
import { createReimportSlice, type ReimportSlice } from "./reimport";
import { createReimportAllSlice, type ReimportAllSlice } from "./reimportAll";
import { createPanelsSlice, type PanelsSlice } from "./panels";
import { createPointerToolSlice, type PointerToolSlice } from "./pointerTool";
import { createSplitSlice, type SplitSlice } from "./split";
import { createShapesSlice, type ShapesSlice } from "./shapes";
import { createRegionShadesSlice, type RegionShadesSlice } from "./regionShades";
import { createLibraryPanelSlice, type LibraryPanelSlice } from "./libraryPanel";
import { createToolWindowsSlice, type ToolWindowsSlice } from "./toolwindows";
import { createGraphBuilderSlice, type GraphBuilderSlice } from "./graphBuilder";
import { createCellEditSlice, type CellEditSlice } from "./cellEdit";
import { createDatasetMetaSlice, type DatasetMetaSlice } from "./datasetMeta";
import { createDataIntakeSlice, type DataIntakeSlice } from "./dataIntake";
import { folderDeletePatch } from "./folderDelete";
import { createImportSlice, type ImportSlice } from "./importDatasets";
import { createWorkbookActionsSlice, type WorkbookActionsSlice } from "./workbookActions";
import { createWorkbookCombineSlice, type WorkbookCombineSlice } from "./workbookCombine";
import { createWorkbookSeparateSlice, type WorkbookSeparateSlice } from "./workbookSeparate";
import { createWorkbookTransferSlice, type WorkbookTransferSlice } from "./workbookTransfer";
import { recomputeStaleFits } from "./recalcFits";
import { removeDatasetsPatch } from "./removeDatasets";
import { createRecentsSlice, type RecentsSlice } from "./recents";
import { createProjectSlice, type ProjectSlice } from "./project";
import { createTrashSlice, type TrashSlice } from "./trash";
import { createComputedColumnsSlice, type ComputedColumnsSlice } from "./computedColumns";
import { createDerivedWorksheetsSlice, recomputeDerivedSheet, type DerivedWorksheetsSlice } from "./derivedWorksheets";
import { createCorrectionsSlice, rowsChangedGuard, type CorrectionsSlice } from "./corrections";
import { createFigureLifecycleSlice, type FigureLifecycleSlice } from "./figureLifecycle";
import { createQuickPlotActionSlice, type QuickPlotActionSlice } from "./quickPlotAction";
import { createQuickFigureCreateSlice, type QuickFigureCreateSlice } from "./quickFigureCreate";
import { createQuickPlotTemplatesSlice, type QuickPlotTemplatesSlice } from "./quickPlotTemplates";
import { createPlotRecipesSlice, type PlotRecipesSlice } from "./plotRecipes";
import { createCollectionsSlice, type CollectionsSlice } from "./collections";
import { createLibraryDetailsColumnsSlice, type LibraryDetailsColumnsSlice } from "./libraryDetailsColumns";
import { createQuickFigureBuilderSlice, type QuickFigureBuilderSlice } from "./quickFigureBuilder";
import { createPageDocumentsSlice, type PageDocumentSlice } from "./pageDocuments";
// RSM_CUTS_PLAN item 4: rsmPeaks/setRsmPeaks relocated here (see rois.ts's
// header) to pay for this slice's own composition cost under the pin.
import { createRoisSlice, type RoisSlice } from "./rois";
// RSM_CUTS_PLAN item 8: just the ToolWindow's open flag — see the file header.
import { createRoiCutsPanelSlice, type RoiCutsPanelSlice } from "./roiCutsPanel";
import { breakComposition, facetComposition, spatialComposition, type Composition } from "../lib/composition";
import { breakPayloads, facetPayloads, suggestBreaks } from "../lib/facet";
import type { ReportEntry, ReportSheet } from "../lib/report";
import { buildOverlayDataset, originOverlayDataset, overlayCurveLabels, overlayCurveStyles } from "../lib/originOverlay";
import { nextPanelFit, type PanelFit } from "../lib/panelLayout";
import { pageSetupFromDecoded, type PageSetup } from "../lib/pagesetup";
import { isActive } from "../lib/datafilter";
import type { FwhmResult } from "../lib/peakwidth";
import { effectiveChannels } from "../lib/plotdata";
import { docRenderable, type FigureDoc } from "../lib/figuredoc";
import { downstreamOf, markStale, type RecalcMode } from "../lib/recalc";
import { fitStepParams } from "../lib/fitselection";
import { firstVisiblePlottedChannel, qfitSpec, selectRoiRows, type GadgetMode } from "../lib/quickfit";
import { analysisData, expandToFull, keepOnlyExcluded, mergeExcluded, sanitizeExcluded, toggleExcluded } from "../lib/rowstate";
import { toast } from "./toasts";
import { confirmOriginReapplyDiscard, deferOriginFigureApply } from "./originFigureApply";
import { loadPrefs, syncPrefs, type Prefs } from "./prefs";
import { createOriginImportSlice, type OriginImportSlice } from "./originImport";
import { createOriginFallbackSlice, type OriginFallbackSlice } from "./originFallback";
import type {
  Annotation,
  AxisFormat, AxisScale,
  BaselineOverlay,
  CalcResult,
  ChannelRole,
  DataFilter,
  Dataset,
  DataStruct,
  FitOverlay, FitSpec,
  FolderNode,
  ModelingType,
  PeakOverlay,
  RefLine,
  SeriesStyle,
} from "../lib/types";
/** Recompute a dataset's computed columns from its current base (no-op without
 *  formulas). Routed through after any base-data mutation (cell edit, corrections).
 *  Exported for store/corrections.ts (nextDatasetId/split.ts precedent) — the
 *  corrections slice re-derives computed columns after every apply/reset from
 *  the SAME formula-recompute logic every other base-data mutation here uses.
 *  LIBRARY_WORKBOOK_UX_PLAN PR K (K5b): also refreshes `formulaErrors` in the
 *  same pass, so a base-data edit that fixes (or breaks) a formula's
 *  evaluation keeps the visible error state in sync everywhere `recompute`
 *  is the chokepoint — not just at the store/computedColumns.ts authoring
 *  sites. */
export const recompute = (d: Dataset): Dataset => {
  if (!d.formulas?.length) return d;
  const { data, errors } = recomputeWithErrors(d.data, d.formulas);
  return { ...d, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
};
let _refSeq = 0;
let _annSeq = 0;
let _idSeq = 0;
// Exported for store/split.ts (nextWindowId/panels.ts precedent) — a split
// mints several dataset ids + one folder id from the SAME sequence used
// everywhere else, so they can never collide with an id minted here.
export const nextDatasetId = (): string => `ds-${Date.now().toString(36)}-${++_idSeq}`;
export const nextFolderId = (): string => `fld-${Date.now().toString(36)}-${++_idSeq}`;
const nextReportId = (): string => `rep-${Date.now().toString(36)}-${++_idSeq}`;
// (window ids: see store/windows.ts — the MDI slice owns its own sequence)

// (single-flight lazy-book resolution — ORIGIN_FILE_DECODE_PLAN #38 —
// extracted to lib/bookData.ts under this module's size ratchet; the four
// resolve*/ensureBookData actions that call it, plus pasteDataFromClipboard,
// now live in store/dataIntake.ts — DataIntakeSlice, composed below.)

// (mainWindow / focusTransientReset / datasetViewDefaults / focusedRebindPatch /
// retargetPassiveRebind moved to store/windows.ts with the window slice —
// imported above for the setActive/addDataset/loadWorkspace paths.)

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
// Stage-tab routing lives in lib/stagetab (MAIN_PLAN #2 — the window slice
// needs it without a runtime cycle); re-exported so existing imports hold.
export { nextStageTab, plotIntentStageTab } from "../lib/stagetab";
export type { StageTab } from "../lib/stagetab";
/** How excluded/filtered rows (#50/#53) render on the plot: "hide" drops them
 *  (gaps); "grey" draws them as muted markers. Fits exclude them either way. */
export type ExcludedDisplay = "hide" | "grey";
/** WORKSHEET_PLAN item 15 ("origin book click opens…"): what a Library click
 *  on an Origin-project dataset does — "worksheet" (default, Origin's own
 *  model: opening a workbook never touches your graphs) or "plot" (the
 *  pre-item-12 behavior — restores the unconditional plot-intent activation
 *  for every dataset, Origin or not). See `useApp.activateFromLibrary`. */
export type OriginBookClickOpens = "worksheet" | "plot";
export type PlotTool =
  | "pointer"
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
  mode: "box" | "violin" | "bar";
  groupCol: number | null;
  valueCol: number;
  facetCol?: number | null; // GUI_INTERACTION #11: facet column, null = unfaceted
}

/** Peak Analyzer wizard click-on-plot marker editing (interaction plan item
 *  5, deferred from closed gap #31) — the bridge PlotStage reads to wire
 *  `peakMarkerEditPlugin` (lib/peakMarkerHit.ts). `usePeakWizard` is the sole
 *  owner of the candidate list and `addPeakAt`/`removePeak`; this is a THIN,
 *  minimal projection (marker data coords + the two callbacks) pushed into
 *  the store only while step ② is live — null the rest of the time (wizard
 *  closed, a different step, or Escape-suppressed). Mirrors
 *  ReflectivitySeed/StatStageSeed's cross-panel-hook shape, generalized to a
 *  live bridge rather than a one-shot consume (closer in spirit to
 *  qfitRoi/onRoiChange, but the callbacks travel WITH the data since
 *  usePeakWizard — not the store — owns the compute). */
export interface PeakWizardEditBridge {
  markers: { index: number; center: number; height: number }[];
  addPeakAt: (x: number) => void;
  removePeak: (index: number) => void;
}

/** Anchor-point baseline click/drag editing (GOTO #2) — the bridge PlotStage
 *  reads to wire `anchorEditPlugin` (lib/uplotAnchors.ts). `useBaseline` owns
 *  the anchor list + mutators; published only while the workshop's "Anchor
 *  points" method is live, null otherwise. Anchors are (x, y) DATA coords.
 *  IDENTITY CONTRACT (MAIN #8f): published ONCE per activation and stable
 *  across edits — anchors flow through `getAnchors` (a ref read), because
 *  PlotViewport keys its uPlot-rebuild effect on this object's identity. */
export interface AnchorEditBridge {
  getAnchors: () => { index: number; x: number; y: number }[];
  addAnchor: (x: number, y: number) => void;
  moveAnchor: (index: number, x: number, y: number) => void;
  removeAnchor: (index: number) => void;
}

export type LegendPos = "ne" | "nw" | "se" | "sw";
// Keys the Preferences dialog can set through the generic setPref action.
// DERIVED from `Prefs` rather than restated: the hand-maintained union had
// to be edited in lockstep with prefs.ts for every new preference, which is
// drift waiting to happen (and 18 lines of it). `keyof` cannot go stale.
export type PrefKey = keyof Prefs;

// Exported for the window slice (store/windows.ts), which types its actions
// against the WHOLE composed store — cross-slice reads/writes are the point
// of slice composition (type-only in that direction, so no runtime cycle).
export interface AppState extends WindowsSlice, HistorySlice, ReductionsSlice, ReimportSlice, ReimportAllSlice, PanelsSlice, PointerToolSlice, SplitSlice, ShapesSlice, RegionShadesSlice, ToolWindowsSlice, OriginImportSlice, OriginFallbackSlice, WorksheetSelectionSlice, LibraryPanelSlice, GraphBuilderSlice, CorrectionsSlice, ComputedColumnsSlice, DerivedWorksheetsSlice, CellEditSlice, DatasetMetaSlice, DataIntakeSlice, TrashSlice, ImportSlice, RecentsSlice, ProjectSlice, FigureLifecycleSlice, QuickPlotActionSlice, QuickFigureCreateSlice, QuickPlotTemplatesSlice, PlotRecipesSlice, QuickFigureBuilderSlice, PageDocumentSlice, RoisSlice, RoiCutsPanelSlice, WorkbookActionsSlice, CollectionsSlice, WorkbookCombineSlice, WorkbookSeparateSlice, LibraryDetailsColumnsSlice, WorkbookTransferSlice {
  datasets: Dataset[];
  activeId: string | null;
  // Multi-selection for bulk ops (Delete key). `activeId` stays the plotted
  // "primary"; ctrl/shift-click extend `selectedIds` without changing the plot.
  selectedIds: string[];
  // WORKSHEET_PLAN item 15 ("origin book click opens…"): the Worksheet tab's
  // dataset override, set by `activateFromLibrary`'s worksheet-intent path
  // instead of `activeId` — `activeId` stays the FOCUSED plot window's bound
  // dataset (PlotStage/Inspector/every workshop MUST keep reading it
  // unchanged, per MULTI_PLOT_PLAN's facade). null = "no override"
  // (`Worksheet.tsx` falls back to `activeId`); `setActive` clears it.
  worksheetId: string | null;
  // Report sheets (#36): named analysis reports (curve fits, peak tables,
  // stats) living in the library. `datasetId` ties one back to its source
  // dataset (nulled if that dataset is removed — the report itself stays, it
  // is a computed artifact, not a view). Round-trips .dwk.
  reports: ReportEntry[];
  // The report currently open in the viewer ToolWindow (null = closed).
  openReportId: string | null;
  // Legacy publication-preview documents; canonical editable figures live in FigureLifecycleSlice.
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
  // Library folder tree (project-organization plan, Approach B): pure
  // organization over `datasets[]` (`Dataset.folderId`); never gates row-state.
  folders: FolderNode[];
  // Library workbooks (LIBRARY_WORKBOOK_UX_PLAN L0.1's folder -> workbook ->
  // worksheet/figure/analysis/note hierarchy, PR A2). Membership rides on
  // `Dataset.workbookId`, same design as `folders`/`folderId` above; this
  // array is populated ONLY by loadWorkspace (from `ws.workbooks ?? []` —
  // see that action's doc for why the explicit fallback matters) until PR
  // A3/A4 add mutating actions.
  workbooks: WorkbookNode[];
  // Expanded folder ids (Library tree UI state); persisted so a project reopens
  // with the same folders open. Round-trips .dwk v2.
  expandedFolders: string[];
  // Smart folders (item 9): saved tag/name/format queries rendered as
  // cross-cutting Library sections. Membership is DERIVED at render time
  // (lib/smartfolders) — only the queries persist (.dwk).
  smartFolders: SmartFolder[];
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
  /** MAIN #35: Copy figure background — transparent vs the preset's opaque. */
  copyFigureTransparent: boolean;
  antialias: boolean;
  sigFigs: number;
  notation: Notation;
  confirmRemove: boolean;
  excludedDisplay: ExcludedDisplay;
  originBookClickOpens: OriginBookClickOpens;
  // #54: app-wide default fit a fresh Origin multi-panel apply starts from
  // (frames = aspect-preserving letterbox, window = fill). Read at apply time,
  // mirroring how `defaultGrid` seeds `showGrid`.
  defaultPanelFit: PanelFit;
  prefsOpen: boolean;
  yScale: AxisScale; // Y axis scale (MAIN #12: linear/log/reciprocal)
  xScale: AxisScale; // X axis scale
  showGrid: boolean; // draw the plot grid lines
  showLegend: boolean; // show the floating legend overlay
  legendPos: LegendPos; // which corner the floating legend pins to
  legendStatic: boolean; // clean read-only legend (Origin apply, decode #52)
  legendTitle: string | null; // legend header text (Origin apply, decode #52)
  plotTemplate: string; // on-screen publication template (base font + line width)
  showAxisBox: boolean; // draw a full frame around the plot area
  stackMode: boolean; // multi-panel: one stacked sub-plot per channel
  panelFit: PanelFit; // #54: how a spatial multi-panel view fills the stage (PlotView field)
  pageSetup: PageSetup | null; // #54: this window's physical page model (PlotView field; null = none)
  // How the stage is arranged into panels (#54 pass A): ONE discriminated
  // union replacing the former parallel `spatialPanels`/`facetPanels`/
  // `breakPanels` nullable arrays, whose mutual exclusion every assigning
  // `set()` had to re-enforce by hand. `null` = no multi-panel arrangement.
  // Set by `applyOriginFigure` (spatial), `facetByColumn` (facet) and
  // `breakAtGaps` (break); cleared by `setStackMode` and `setActive` so a
  // manual toggle or a different dataset never shows a stale arrangement.
  // EPHEMERAL — never persisted; a `.dwk` restore nulls it and the producing
  // action recomputes. Each kind's panel shape, why the three differ, and the
  // reference-stable accessors: `lib/composition.ts`.
  composition: Composition | null;
  insetMode: boolean; // show a magnifier inset over the plot
  polarMode: boolean; // render the active series in polar (angle vs radius)
  statMode: boolean; // render the Statistics stage (box/violin/qq/histogram, gap #16)
  xLim: [number, number] | null; // explicit X range (null = autoscale)
  yLim: [number, number] | null; // explicit Y range (null = autoscale)
  // Origin's decoded major-tick increment for a FIXED log axis (plot-fidelity
  // fix #2) — only meaningful alongside xLim/yLim/y2Lim; see
  // `lib/uplotOpts.fixedLogAxisSplits`'s doc. null = undecoded (falls back to
  // a "nice number" step). Reset whenever the paired *Lim is reset/replaced
  // by anything other than an Origin figure apply, so a stale step never
  // leaks onto an unrelated manual range.
  xStep: number | null;
  yStep: number | null;
  xFmt: AxisFormat; // X-axis tick number format
  yFmt: AxisFormat; // Y-axis tick number format (default source for y2Fmt when null)
  y2Fmt: AxisFormat | null; // secondary-axis tick format; null = inherit yFmt (default)
  plotTitle: string; // chart title rendered above the plot ("" = none)
  xAxisLabel: string; // override for the x-axis label ("" = auto from data)
  yAxisLabel: string; // override for the primary y-axis label ("" = auto)
  xKey: number | null; // value channel used as the plot x-axis (null = .time)
  yKeys: number[] | null; // which value channels to plot (null = all)
  groupKey: number | null; // P1.5 "Group" well channel — splits each plotted Y into one series per level
  y2Keys: number[] | null; // channels drawn on the secondary (right) Y axis
  y2Lim: [number, number] | null; // fixed secondary-Y range (Origin double-Y apply)
  y2Scale: AxisScale | null; // secondary-Y scale (null = inherit yScale)
  y2Step: number | null; // decoded major-tick increment for y2Lim (see xStep/yStep)
  y2AxisLabel: string; // override for the secondary y-axis label ("" = auto)
  refLines: RefLine[]; // fixed X/Y marker lines on the plot
  annotations: Annotation[]; // text labels pinned at data coordinates
  // regionShades: declared by RegionShadesSlice (store/regionShades.ts) —
  // owns the array + its create/edit/remove actions (F2.3j).
  seriesStyles: Record<number, SeriesStyle>; // per-channel color/width/line overrides
  seriesLabels: Record<number, string>; // per-channel display-name overrides (legend rename)
  errKeys: Record<number, number>; // y-channel index → channel holding its ± error (error bars)
  seriesOrder: number[] | null; // explicit plotted-channel draw order (null = natural/yKeys order)
  hiddenChannels: number[]; // channels toggled off via the interactive legend (kept in payload, not drawn)
  waterfall: number; // waterfall offset as a fraction of the y-span (0 = off)
  // plotWindows / focusedWindowId / plotCanvasBounds live in the WindowsSlice
  // this interface extends (store/windows.ts). The PlotView singleton fields
  // ABOVE this line are the FOCUSED window's LIVE view — see the facade doc
  // on WindowsSlice.
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
  cmdkOpen: boolean; curveFitOpen: boolean;
  hysteresisOpen: boolean; peaksOpen: boolean;
  reflectivityOpen: boolean;
  // A pending SLD layer seeded by the calculators SLD tab; consumed once by the
  // reflectivity workshop on open, then cleared (cross-panel hook).
  reflectivitySeed: ReflectivitySeed | null;
  baselineOpen: boolean; calculatorsOpen: boolean;
  magToolsOpen: boolean;
  rsmOpen: boolean; digitizerOpen: boolean;
  datasetMathOpen: boolean; tabulateOpen: boolean;
  distributionOpen: boolean;
  dataFilterOpen: boolean;
  statsChooserOpen: boolean; // the "which test?" front door (#26)
  peakWizardOpen: boolean; // the Peak Analyzer stepper (#31)
  importWizardOpen: boolean; // guess/preview/parse over a saved-filter (#40)
  pipelineOpen: boolean; // the editable pipeline view (#6)
  figureBuilderOpen: boolean;
  figurePageOpen: boolean; // the multi-panel figure page composer (GOTO #4)
  // graphBuilderOpen/graphBuilderSeed/savedPlotSpecs/activePlotSpecId now live
  // on GraphBuilderSlice (store/graphBuilder.ts) — see AppState's extends list.
  // One-shot pickers handed from the Graph Builder to the stat stage when a
  // box/violin spec is sent (consumed + cleared by useStatStage). null = none.
  statStageSeed: StatStageSeed | null;
  waterfallOpen: boolean;
  reflViewOpen: boolean;
  columnSwitcherOpen: boolean; // the JMP-style solo-a-channel flipper (#54)
  shortcutsOpen: boolean;
  textFormatHelpOpen: boolean; // Help ▸ Text formatting (GOTO #11)
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  // Peak wizard click-on-plot marker editing (item 5) — see PeakWizardEditBridge.
  peakWizardEdit: PeakWizardEditBridge | null;
  // Anchor-point baseline editing (GOTO #2) — see AnchorEditBridge.
  baselineAnchorEdit: AnchorEditBridge | null;
  // rsmPeaks/setRsmPeaks: see RoisSlice (store/rois.ts) — relocated there
  // under the store-size ratchet (RSM_CUTS_PLAN item 4).
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

  /** `historyToken`: forward the token an enclosing `withHistoryBatch` gave
   *  the caller (e.g. `importPaths`) so this add folds into that batch's
   *  one undo entry instead of pushing its own — see `HistoryBatchToken`'s
   *  doc (store/history.ts) for why a token, not a boolean, is what makes
   *  that operation-scoped rather than a global suppress (R6). Omitted by
   *  every other call site (paste/merge/demo/derived-worksheet/etc.), which
   *  keep recording their own independent entry exactly as before. */
  addDataset: (ds: Dataset, historyToken?: HistoryBatchToken) => void;
  // Import ≥2 files and concatenate them row-wise into ONE dataset (gap #47) —
  // the alternative to importFiles' N-separate-datasets result, for same-shape
  // multi-file series (e.g. a scan split across daily files). Falls back to
  // importFiles (separate datasets + a toast) on a shape mismatch or an Origin
  // multi-workbook file, so it never produces a dead import.
  importFilesAppended: (files: File[]) => Promise<void>;
  // ensureBookData / resolvePendingDatasets / resolveDataset / resolveDatasets
  // / pasteDataFromClipboard: see store/dataIntake.ts (DataIntakeSlice).
  // "Save workspace (.dwk)…" (App.tsx's File menu command): resolves every
  // pending lazy book first (see `resolvePendingDatasets`'s doc), then
  // serializes + downloads. Owns its own status/toast messaging so the
  // command itself stays a thin `run: () => s().saveWorkspaceToFile()`.
  saveWorkspaceToFile: () => Promise<void>;
  // P1.2 box 1: "Save" (Ctrl+S) — writes to the known project path with no
  // dialog when one exists; otherwise identical to saveWorkspaceToFile.
  saveWorkspace: () => Promise<void>;
  // Apply a stored figure after resolving lazy source books; unresolved = no-op.
  // `opts.newWindow` (item 9) opens a fresh window (bound to the figure's
  // dataset) and focuses it FIRST, so the rest of the apply logic — already
  // scoped to "the focused window" via `setActive`/the singleton `set()`
  // calls — lands on the new window instead of overwriting whatever was
  // focused before.
  applyOriginFigure: (id: string, opts?: { newWindow?: boolean; discardConfirmed?: boolean }) => void;
  // Facet-by-column (gap #21 residual): partitions `datasetId`'s analysis-view
  // rows into one small-multiples panel per distinct level of `col` (via
  // `lib/facet.facetPayloads`) and sets a facet `composition` for
  // MultiPanelStage to render. Activates `datasetId`, turns on `stackMode`,
  // and REPLACES any prior arrangement (the union makes that structural).
  // No-op (with a toast) when the dataset is missing or the column has no
  // finite levels to facet on.
  facetByColumn: (datasetId: string, col: number) => void;
  // Paneled x-breaks (gap #21 last residual): mirrors `facetByColumn`'s shape
  // but slices `datasetId`'s CURRENT x-column into contiguous segments (via
  // `lib/facet.breakPayloads`) instead of partitioning by a category column.
  // `breaks` is an explicit `[lo,hi]` override list; when omitted (or empty),
  // auto-detects via `lib/facet.suggestBreaks(xs, gapFactor)`. Activates
  // `datasetId`, turns on `stackMode`, and replaces any prior `composition`.
  // No-op (with a toast) when the dataset is missing, has no
  // rows in the analysis view, or no qualifying gap/override breaks exist.
  breakAtGaps: (datasetId: string, breaks?: [number, number][], gapFactor?: number) => void;
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
  /** Open an ephemeral or saved FigureDoc without adding it to the library. */
  openFigureDraft: (doc: FigureDoc) => void;
  openFigureDoc: (id: string) => void;
  // Item 9's figure-doc half: opens a NEW window bound to the doc's dataset
  // and applies its channel/scale/label config (xKey/yKeys/log flags/titles)
  // onto it. Live docs with a resolved dataset only — a frozen doc's data
  // snapshot isn't a live `Dataset` a window can bind to (that's Tier 3 item
  // 11's "snapshot-as-window" kind); a no-op otherwise.
  openFigureDocInWindow: (id: string) => void;
  clearFigureDocSeed: () => void;
  setRecalcMode: (mode: RecalcMode) => void;
  touchDataset: (id: string) => void;
  recalcNow: () => Promise<void>;
  setFitSpec: (id: string, spec: FitSpec | null) => void;
  // `skipLayout` (PR E2 "Open without layout…") ignores plotWindows/
  // focusedWindowId/toolWindowLayout, falling through to the same default.
  loadWorkspace: (ws: WorkspaceState, options?: { skipLayout?: boolean }) => void;
  // Append a second .dwk's datasets into the CURRENT library (Origin's
  // "Append Project", MAIN_PLAN #16) — the additive opposite of
  // loadWorkspace: only the flat dataset list joins (collision-free ids +
  // names, see lib/workspace.mergeWorkspace); activeId, plotWindows, every
  // view-state field, and the existing datasets are left completely alone.
  appendWorkspace: (ws: LoadedWorkspace) => void;
  setActive: (id: string) => void;
  // WORKSHEET_PLAN item 15: the routed Library-click entry point — EVERY
  // "click/select a row" site (DatasetRow's plain click + pre-menu select,
  // the Library arrow-key nav, the worksheet's own sheet/book-switcher tabs)
  // calls THIS, never `setActive` directly, so they all honor the
  // `originBookClickOpens` preference the same way. Routes to a worksheet-
  // intent path (sets `worksheetId`, switches to the Worksheet tab, leaves
  // the focused plot window and its view untouched) for an Origin-project
  // dataset when the pref is "worksheet" (default); falls through to
  // `setActive` (unconditional plot-intent) for every non-Origin dataset,
  // and for an Origin one when the pref is "plot". `setActive` itself stays
  // the unconditional plot-intent primitive on purpose — explicit "Plot
  // (make active)", figure apply, and the worksheet's own Plot-selection/
  // Add-to-plot rebind (`lib/selectionplot` via `useWorksheetView.plotCols`)
  // all call it directly.
  activateFromLibrary: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectRange: (id: string) => void;
  // Replace the multi-selection with an explicit id list (folder bulk ops,
  // item 8) — like ctrl-click, it never moves the plotted/active dataset.
  selectIds: (ids: string[]) => void;
  removeDataset: (id: string) => void;
  removeSelected: () => void;
  // Bulk-remove by explicit id list (item 17's book-family filter dialog) —
  // distinct from removeSelected, which acts on the transient row selection.
  removeDatasets: (ids: string[]) => void;
  // Wipe the whole library (datasets + folders + figures + selection + view
  // state) — the File ▸ Remove all command; reuses loadWorkspace's reset.
  clearAll: () => void;
  // Concatenate the multi-selected datasets (≥2) row-wise into a new dataset.
  // Resolves any still-pending picks first (#38) — a batch of arbitrary
  // selected datasets is exactly the "never activated" risk case.
  mergeSelected: () => Promise<void>;
  // Resolves a still-pending source first (#38): `pending` isn't copied onto
  // the clone, so without this the copy would silently become a SEPARATE
  // dataset permanently stuck on the small preview (nothing would ever
  // trigger its own fetch).
  duplicateDataset: (id: string) => Promise<void>;
  moveDataset: (id: string, dir: -1 | 1) => void;
  renameDataset: (id: string, name: string) => void;
  // addFormula/removeFormula/updateFormula live on ComputedColumnsSlice
  // (store/computedColumns.ts) — see AppState's extends list.
  // Folder tree (project-organization plan item 1). Thin wrappers over
  // lib/foldertree; datasets stay a flat array (membership is Dataset.folderId).
  createFolder: (parentId: string | null, name?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string, mode?: "reparent" | "cascade") => void;
  moveFolder: (id: string, newParentId: string | null, beforeId?: string) => void;
  moveDatasetToFolder: (id: string, folderId: string | null, beforeId?: string) => void;
  toggleFolderExpanded: (id: string) => void;
  // updateFolder (Properties: notes/colour/defaultTemplate) lives on
  // LibraryPanelSlice (store/libraryPanel.ts) — ratchet headroom.
  // Smart folders (item 9): saved queries only — membership is derived.
  addSmartFolder: (name: string, query: string) => void;
  updateSmartFolder: (id: string, name: string, query: string) => void;
  removeSmartFolder: (id: string) => void;
  // applyCorrections/resetCorrections/applyCorrectionsToMany live on
  // CorrectionsSlice (store/corrections.ts) — see AppState's extends list.
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
  setYScale: (yScale: AxisScale) => void;
  setXScale: (xScale: AxisScale) => void;
  setShowGrid: (showGrid: boolean) => void;
  setShowLegend: (showLegend: boolean) => void;
  setLegendPos: (pos: LegendPos) => void;
  setLegendStatic: (v: boolean) => void;
  setPlotTemplate: (template: string) => void;
  setShowAxisBox: (show: boolean) => void;
  setStackMode: (stackMode: boolean) => void;
  setPanelFit: (mode: PanelFit) => void; // #54
  cyclePanelFit: () => void; // #54 — frames<->window, +page when a pageSetup exists
  setPageSetup: (pageSetup: PageSetup | null) => void; // #54
  setInsetMode: (insetMode: boolean) => void;
  setPolarMode: (polarMode: boolean) => void;
  setStatMode: (statMode: boolean) => void;
  setXLim: (xLim: [number, number] | null) => void;
  setYLim: (yLim: [number, number] | null) => void;
  // Secondary (right) Y axis: expose the already-rendered y2Scale/y2Lim fields
  // so the plot context menu can edit an Origin double-Y import's right axis.
  // Only meaningful when y2Keys is non-empty (otherwise there is no y2 scale).
  setY2Scale: (y2Scale: AxisScale | null) => void;
  setY2Lim: (y2Lim: [number, number] | null) => void;
  setXFmt: (xFmt: AxisFormat) => void;
  setYFmt: (yFmt: AxisFormat) => void;
  setY2Fmt: (y2Fmt: AxisFormat | null) => void;
  setPlotTitle: (plotTitle: string) => void;
  setXAxisLabel: (xAxisLabel: string) => void;
  setYAxisLabel: (yAxisLabel: string) => void;
  setY2AxisLabel: (y2AxisLabel: string) => void;
  setXKey: (xKey: number | null) => void;
  setYKeys: (yKeys: number[] | null) => void;
  setGroupKey: (groupKey: number | null) => void;
  setY2Keys: (y2Keys: number[] | null) => void;
  addRefLine: (axis: "x" | "y", value: number) => void;
  removeRefLine: (id: string) => void;
  updateRefLine: (id: string, value: number) => void;
  addAnnotation: (x: number, y: number, text: string) => string;
  removeAnnotation: (id: string) => void;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  resetSeriesStyle: (channel: number) => void;
  setSeriesLabel: (channel: number, label: string) => void;
  setErrKey: (channel: number, errChannel: number | null) => void;
  setChannelRole: (channel: number, role: ChannelRole | null) => void;
  setChannelType: (id: string, channel: number, t: ModelingType | null) => void;
  // Row state (#50): persistent per-row exclusion on a dataset. Excluded rows
  // stay visible but drop from analysis everywhere; round-trips .dwk.
  toggleRowExcluded: (id: string, row: number) => void;
  setRowsExcluded: (id: string, rows: number[]) => void;
  clearRowExclusions: (id: string) => void;
  // Row selection (#50 selection dimension): a transient brush on the active
  // dataset. `selection` is null or {datasetId, rows}; it is "live" only when its
  // datasetId matches activeId, so switching datasets naturally drops it (no
  // reset wiring). This is the Stage "Worksheet" tab's channel only — an MDI
  // document window uses its own independent one (`worksheetSelections`,
  // GUI_INTERACTION #14, store/worksheetSelection.ts). The bulk actions turn a
  // selection into persistent exclusions; their optional `windowId` targets
  // that per-window map instead (omit it for the Stage tab's own selection).
  selection: { datasetId: string; rows: number[] } | null;
  toggleRowSelected: (row: number) => void;
  setRowSelection: (rows: number[]) => void;
  clearRowSelection: () => void;
  excludeSelectedRows: (windowId?: string) => void;
  keepOnlySelectedRows: (windowId?: string) => void;
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
  // (createWindow … windowsForSave — the window-management actions — are
  // declared on WindowsSlice; see store/windows.ts.)
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
  setFigurePageOpen: (open: boolean) => void;
  // Send a box/violin Graph Builder spec to the stat stage: store the pickers +
  // switch statMode on; clearStatStageSeed drops the pending pickers once read.
  seedStatStage: (seed: StatStageSeed) => void;
  clearStatStageSeed: () => void;
  setWaterfallOpen: (open: boolean) => void;
  setReflViewOpen: (open: boolean) => void;
  setColumnSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setTextFormatHelpOpen: (open: boolean) => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
  setBaselineOverlay: (overlay: BaselineOverlay | null) => void;
  setPeakWizardEdit: (edit: PeakWizardEditBridge | null) => void;
  setBaselineAnchorEdit: (edit: AnchorEditBridge | null) => void;
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

// #14: the live selection for excludeSelectedRows/keepOnlySelectedRows — a
// document window's own map entry, or the legacy active-dataset singleton
// for the Stage tab (`windowId` omitted); same stale-datasetId guard either way.
function worksheetOrActiveSelection(
  s: AppState,
  windowId: string | undefined,
): { datasetId: string; rows: number[] } | null {
  if (windowId) return s.worksheetSelections[windowId] ?? null;
  const id = s.activeId;
  return id != null && s.selection?.datasetId === id ? s.selection : null;
}

// Appearance/behaviour prefs persistence (the `qz.prefs` blob) lives in
// store/prefs.ts (store-size ratchet, #54) — `loadPrefs`/`syncPrefs` imported
// above; `defaultPanelFit` (#54) rides the same mechanism as `defaultGrid`.
const _initialPrefs = loadPrefs();

// Origin figures apply boxed + gridless (item 4; grid undecodable) — Origin's clean look, ticks still draw, user re-enables.
// Origin figures apply gridless + boxed + a clean read-only legend (decode
// #52); every apply branch spreads this, so `legendStatic` costs zero lines.
const ORIGIN_FIGURE_AXIS = { showAxisBox: true, showGrid: false, legendStatic: true };

export const useApp = create<AppState>((set, get) => ({
  // Composed slices — one create*Slice per store/ file, each self-documented.
  ...createWindowsSlice(set, get),
  ...createWorksheetSelectionSlice(set),
  ...createHistorySlice(set, get),
  ...createReductionsSlice(set),
  ...createReimportSlice(set, get),
  ...createReimportAllSlice(set, get),
  ...createPanelsSlice(set),
  ...createPointerToolSlice(set, get),
  ...createSplitSlice(set, get),
  ...createShapesSlice(set, get),
  ...createRegionShadesSlice(set, get),
  ...createToolWindowsSlice(set),
  ...createOriginImportSlice(set),
  ...createOriginFallbackSlice(set, get),
  ...createLibraryPanelSlice(set, _initialPrefs.libraryPanelWidth),
  ...createGraphBuilderSlice(set, get),
  ...createCorrectionsSlice(set, get),
  ...createComputedColumnsSlice(set, get),
  ...createDerivedWorksheetsSlice(set, get),
  ...createCellEditSlice(set, get),
  ...createDatasetMetaSlice(set, get),
  ...createDataIntakeSlice(set, get),
  ...createTrashSlice(set, get),
  ...createImportSlice(set, get),
  ...createRecentsSlice(set),
  ...createProjectSlice(set),
  ...createFigureLifecycleSlice(set, get),
  ...createQuickPlotActionSlice(set, get),
  ...createQuickFigureCreateSlice(set, get),
  ...createQuickPlotTemplatesSlice(set, get),
  ...createPlotRecipesSlice(set, get),
  ...createQuickFigureBuilderSlice(set, get),
  ...createPageDocumentsSlice(set, get),
  ...createRoisSlice(set, get),
  ...createRoiCutsPanelSlice(set),
  ...createWorkbookActionsSlice(set, get),
  ...createCollectionsSlice(set, get),
  ...createLibraryDetailsColumnsSlice(set),
  ...createWorkbookCombineSlice(set, get),
  ...createWorkbookSeparateSlice(set, get),
  ...createWorkbookTransferSlice(set, get),
  datasets: [],
  activeId: null,
  worksheetId: null,
  selectedIds: [],
  reports: [],
  openReportId: null,
  figureDocs: [],
  figureDocSeed: null,
  recalcMode: "auto",
  staleDatasets: [],
  staleFits: [],
  folders: [],
  workbooks: [],
  expandedFolders: [],
  smartFolders: [],
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
  copyFigureTransparent: _initialPrefs.copyFigureTransparent,
  antialias: _initialPrefs.antialias,
  excludedDisplay: _initialPrefs.excludedDisplay,
  originBookClickOpens: _initialPrefs.originBookClickOpens,
  sigFigs: _initialPrefs.sigFigs,
  notation: _initialPrefs.notation,
  confirmRemove: _initialPrefs.confirmRemove,
  defaultPanelFit: _initialPrefs.defaultPanelFit,
  prefsOpen: false,
  yScale: "linear",
  xScale: "linear",
  showGrid: _initialPrefs.defaultGrid,
  showLegend: true,
  legendPos: "ne",
  legendStatic: false,
  legendTitle: null,
  plotTemplate: "screen",
  showAxisBox: false,
  stackMode: false,
  panelFit: "frames",
  pageSetup: null,
  composition: null,
  insetMode: false,
  polarMode: false,
  statMode: false,
  xLim: null,
  yLim: null,
  xStep: null,
  yStep: null,
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  y2Fmt: null,
  plotTitle: "",
  xAxisLabel: "",
  yAxisLabel: "",
  xKey: null,
  yKeys: null,
  groupKey: null,
  y2Keys: null,
  y2Lim: null,
  y2Scale: null,
  y2Step: null,
  y2AxisLabel: "",
  refLines: [],
  annotations: [],
  seriesStyles: {},
  seriesLabels: {},
  errKeys: {},
  seriesOrder: null,
  hiddenChannels: [],
  waterfall: 0,
  plotTool: "pointer",
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
  figurePageOpen: false,
  statStageSeed: null,
  waterfallOpen: false,
  reflViewOpen: false,
  columnSwitcherOpen: false,
  shortcutsOpen: false,
  textFormatHelpOpen: false,
  fitOverlay: null,
  peakOverlay: null,
  baselineOverlay: null,
  peakWizardEdit: null,
  baselineAnchorEdit: null,
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

  addDataset: (ds, historyToken) => {
    // MAIN_PLAN #9: the single entry point for import/paste/demo/merge — one
    // call site covers all of them (mergeSelected/importFilesAppended/
    // pasteDataFromClipboard all route through here).
    get().recordHistory("add dataset", historyToken);
    // Item 14 pin opt-out: an import is a passive rebind, same as a Library
    // click — a pinned focused window never absorbs it (shared helper;
    // `ds.name` seeds the title when a fresh window must be created, since
    // the dataset isn't in the store yet for createWindow to look up).
    retargetPassiveRebind(get(), ds.id, ds.name);
    const defaults = datasetViewDefaults(ds);
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
      selectedIds: [ds.id], // a fresh import is the sole selection
      // L0.25 coherence (retrospective-audit fix): a fresh dataset selection
      // displaces the tree's folder/workbook selection — import targeting
      // read librarySelection BEFORE this point (importTargetFolder.ts), so
      // clearing here never disturbs where the batch landed.
      librarySelection: null,
      // Keep the focused document binding aligned with the newly imported data.
      plotWindows: rebindFocusedPlotWindow(s.plotWindows, s.focusedWindowId, { ...snapshotView(s), ...defaults }, ds),
      stageTab: nextStageTab(ds, s.stageTab), // 2-D maps open in the Map view
      ...defaults, // the shared rebind view reset (item 14 hoist)
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
    }));
  },

  // Upload + parse each picked/dropped file; add to the library (continues on a
  // per-file error so one bad file doesn't abort the batch).

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

  // Body lives in ./workspaceIO (store-size ratchet offset for MAIN_PLAN
  // #16's appendWorkspace — see that file's doc).
  saveWorkspaceToFile: () => runSaveWorkspaceToFile(get),
  saveWorkspace: () => runSaveWorkspace(get),

  applyOriginFigure: (id, opts) => {
    const entry = get().originFigures.find((f) => f.id === id);
    if (!entry?.datasetId) return;
    if (confirmOriginReapplyDiscard(get, entry, id, opts) || deferOriginFigureApply(get, entry, id, opts)) return; // #57 confirm-then-defer
    // Item 9: open a NEW window for this figure instead of overwriting the
    // focused one. Creating (bound to the figure's dataset) then focusing
    // BEFORE any of the apply logic below runs means every `setActive`/
    // singleton `set()` call further down — already scoped to "the focused
    // window" by construction — lands on this new window. Title comes from
    // the figure's own label (deduped against what's already showing), per
    // item 9's "window title from figureLabel / doc name".
    if (opts?.newWindow) {
      const s = get();
      const title = dedupeWindowTitle(
        figureLabel(entry),
        s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
      );
      const winId = s.createWindow(entry.datasetId, undefined, title);
      s.focusWindow(winId);
    }
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
    const existing = get().datasets.find((d) =>
      (d.data.metadata ?? {}).origin_overlay_source === entry.id);
    const overlay = buildOverlayDataset(fig, siblings);
    if (overlay) {
      const targetId = existing?.id ?? nextDatasetId();
      const refreshed = originOverlayDataset(targetId, overlayName, overlay, entry.id, existing);
      if (existing) {
        set((s) => ({
          datasets: s.datasets.map((d) =>
            d.id === existing.id ? refreshed : d
          ),
        }));
      } else {
        get().addDataset(refreshed);
        toast(`built overlay — ${overlay.labels.length} curves`, "ok");
      }
      if (targetId) {
        get().setActive(targetId);
        const src = refreshed.data;
        const n = src?.labels.length ?? 0;
        set({
          ...ORIGIN_FIGURE_AXIS,
          xLim: [fig.x_from, fig.x_to],
          yLim: [fig.y_from, fig.y_to],
          xStep: fig.x_step ?? null,
          yStep: fig.y_step ?? null,
          xScale: scaleFromLog(fig.x_log), // Origin's own axis type is boolean-only
          yScale: scaleFromLog(fig.y_log),
          xKey: null,
          yKeys: Array.from({ length: n }, (_, i) => i),
          // Restore each overlay column's decoded line/scatter look + legend caption.
          seriesStyles: overlayCurveStyles(src),
          seriesLabels: overlayCurveLabels(src),
          // Origin's real axis titles ("" falls back to the data-derived label).
          xAxisLabel: fig.x_title ?? "",
          yAxisLabel: fig.y_title ?? "",
          // Pin the figure's decoded floating text; REPLACE so re-applying
          // or switching figures never stacks stale marks.
          annotations: originFigureAnnotations([fig], entry.id),
          // Decoded Rect* region bands (item 41) — REPLACE, same lifecycle
          // as annotations (figures without shades clear the plot's bands).
          regionShades: originRegionShades([fig], entry.id),
          // Origin's legend placement -> nearest corner preset + decoded title
          // header (decode #52; position only when decoded, never guessed).
          ...originLegendState(fig),
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
          ...ORIGIN_FIGURE_AXIS,
          xLim: [lower.figure.x_from, lower.figure.x_to],
          yLim: [lower.figure.y_from, lower.figure.y_to],
          xStep: lower.figure.x_step ?? null,
          yStep: lower.figure.y_step ?? null,
          xScale: scaleFromLog(lower.figure.x_log),
          yScale: scaleFromLog(lower.figure.y_log),
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
          y2Scale: scaleFromLog(upper.figure.y_log),
          y2Step: upper.figure.y_step ?? null,
          y2AxisLabel: upper.figure.y_title ?? "",
          seriesStyles: { ...baseSel.styles, ...partnerSel.styles },
          seriesLabels: { ...baseSel.labels, ...partnerSel.labels },
          xAxisLabel: lower.figure.x_title ?? "",
          yAxisLabel: lower.figure.y_title ?? "",
          // Both layers' marks (lower first) — REPLACE, never stack. The upper
          // layer's marks are tagged axis:1 so they land on y2 (fix #3), not
          // the primary axis lower.figure's own marks stay on.
          annotations: originFigureAnnotations([lower.figure, upper.figure], entry.id, [0, 1]),
          // Both layers' region bands, the upper layer's tagged to y2 (item 41).
          regionShades: originRegionShades([lower.figure, upper.figure], entry.id, [0, 1]),
          ...originLegendState(lower.figure),
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
    // spatial layout (`originFigures.resolveSpatialPanels`, which resolves
    // every layer, ALSO collapses a frame-coincident double-Y pair into one
    // merged panel before handing the rest to
    // `originPanels.computePanelLayout` — the PNR/S7/Book33 fix: a y2
    // overlay's frame used to trip the whole figure into a bogus 1xN
    // ordinal stack — falling back to a plain top-to-bottom stack only when
    // the (post-merge) geometry wasn't decoded), when EVERY layer resolves
    // to a dataset + plotted channels (all-or-nothing). Falls through to the
    // clicked layer's own single-layer apply below, with a status note, when
    // any layer doesn't resolve.
    const family = figureLayerFamily(entry, get().originFigures);
    if (family.length >= 2) {
      const spatialResult = resolveSpatialPanels(family, get().datasets);
      if (spatialResult) {
        const { panels: placed, layout, droppedOverlays } = spatialResult;
        get().setActive(entry.datasetId);
        // showAxisBox is the SINGLETON flag `useMultiPanelStage` reads for
        // every spatial panel (item 4) — Origin layers are boxed by default.
        set({
          stackMode: true,
          composition: spatialComposition(placed),
          // #54: a fresh tiled apply starts at the app-wide default fit
          // (Preferences ▸ Plot ▸ Multi-panel fit). The per-window value then
          // persists in `.dwk`.
          // A trusted overlapping/inset composition must begin in page mode;
          // the grid-oriented default would otherwise flatten its geometry.
          panelFit: layout === "page" ? "page" : get().defaultPanelFit,
          // #54 Stage 2: prefill the window's page from the figure's decoded
          // page size — aspect-honest (Origin page units aren't physical), null
          // when the page didn't decode. Enables the "page" fit + page export.
          pageSetup: pageSetupFromDecoded(family[0].figure.page ?? null),
          ...ORIGIN_FIGURE_AXIS,
          // Spatial bands live on each SpatialPanel; clear only the singleton
          // overlay list so a prior single plot cannot leak into this view.
          regionShades: [],
        });
        get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
        for (const msg of spatialApplyNotices(layout, placed.length, droppedOverlays)) toast(msg, "info");
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
      ...ORIGIN_FIGURE_AXIS,
      xLim: [fig.x_from, fig.x_to],
      yLim: [fig.y_from, fig.y_to],
      xStep: fig.x_step ?? null,
      yStep: fig.y_step ?? null,
      xScale: scaleFromLog(fig.x_log),
      yScale: scaleFromLog(fig.y_log),
      xAxisLabel: fig.x_title ?? "",
      yAxisLabel: fig.y_title ?? "",
      // Pin the figure's decoded floating text; REPLACE, never stack.
      annotations: originFigureAnnotations([fig], entry.id),
      regionShades: originRegionShades([fig], entry.id),
      ...originLegendState(fig),
      ...figureSelectionState(selection),
    });
    get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
  },
  // Facet-by-column (gap #21 residual): see `lib/composition.ts` for why a
  // facet panel is a different shape from a spatial one.
  // Reads the ANALYSIS view (guard #11 — exclusion #50 ∪
  // filter #53) so faceting honors whatever rows are currently in play, the
  // same contract `plotspec.specToRender`'s facet path already follows. The
  // current x/y channel selection carries over ONLY when `datasetId` is
  // already active (it's a per-dataset choice, meaningless applied to a
  // different dataset's column indices); otherwise `facetPayloads` falls
  // back to its own x=time / default-dense-channels choice, same as a fresh
  // `setActive` would.
  facetByColumn: (datasetId, col) => {
    const ds = get().datasets.find((d) => d.id === datasetId);
    if (!ds) return;
    const data = analysisData(ds);
    if (!data || data.time.length === 0) {
      toast("no rows to facet (all excluded or filtered out)", "danger");
      return;
    }
    const sameActive = get().activeId === datasetId;
    const panels = facetPayloads(
      data,
      col,
      sameActive ? get().xKey : null,
      sameActive ? get().yKeys : null,
    );
    if (panels.length === 0) {
      toast("that column has no finite levels to facet on", "danger");
      return;
    }
    get().setActive(datasetId);
    set({ stackMode: true, composition: facetComposition(panels) });
    get().recordMacro(
      `Facet by ${ds.data.labels[col] ?? `column ${col}`}`,
      `qz.facetByColumn(${lit(datasetId)}, ${col})`,
    );
  },
  // Paneled x-breaks (gap #21 last residual): see the state-field doc comment
  // for the sharing-axis contrast with `facetByColumn`. Reads the ANALYSIS
  // view (guard #11) so a break honors whatever rows are currently in play.
  // The x-column and y-selection carry over ONLY when `datasetId` is already
  // active (same rationale as `facetByColumn`); otherwise falls back to
  // `breakPayloads`' own x=time / default-dense-channels choice.
  breakAtGaps: (datasetId, breaks, gapFactor) => {
    const ds = get().datasets.find((d) => d.id === datasetId);
    if (!ds) return;
    const data = analysisData(ds);
    if (!data || data.time.length === 0) {
      toast("no rows to break (all excluded or filtered out)", "danger");
      return;
    }
    const sameActive = get().activeId === datasetId;
    const xKey = sameActive ? get().xKey : null;
    const yKeys = sameActive ? get().yKeys : null;
    const xs = xKey == null ? data.time : data.values.map((row) => row[xKey]);
    const useBreaks = breaks && breaks.length > 0 ? breaks : suggestBreaks(xs, gapFactor);
    if (useBreaks.length === 0) {
      toast("no large x-gaps found to break at", "danger");
      return;
    }
    const panels = breakPayloads(data, xKey, yKeys, useBreaks);
    if (panels.length < 2) {
      toast("not enough data on both sides of a break to panel", "danger");
      return;
    }
    get().setActive(datasetId);
    set({ stackMode: true, composition: breakComposition(panels) });
    get().recordMacro(`Break x-axis at gaps`, `qz.breakAtGaps(${lit(datasetId)})`);
  },
  // Replace the whole library with a restored workspace (from a .dwk file).
  // Resets every per-dataset view (channels, styles, axis limits) and drops the
  // overlays/markers tied to the old datasets — same hygiene as setActive.
  // Runs on BOTH triggers that call this action: the autosave restore on
  // startup, and an explicit File ▸ Open .dwk — so a legacy v1 doc's `group`
  // strings get promoted to folders (item 6) either way, exactly once.
  loadWorkspace: (ws, options) =>
    set((s) => {
      const skipLayout = options?.skipLayout ?? false; // PR E2, see AppState doc
      // v1/legacy compat: promote any un-foldered `Dataset.group` into a
      // root-level folder before anything else reads `datasets`/`folders` —
      // idempotent, so reloading an already-migrated workspace is a no-op.
      const migrated = migrateGroupsToFolders(ws.folders ?? [], ws.datasets, nextFolderId);
      const datasets = migrated.datasets;
      // Restore the persisted active/selection (v2); v1 or a stale id falls back
      // to the first dataset. Folders + expansion come straight from the doc
      // (plus any folder the group migration just created, auto-revealed).
      const active =
        ws.activeId && datasets.some((d) => d.id === ws.activeId)
          ? ws.activeId
          : (datasets[0]?.id ?? null);
      const activeDs = active ? (datasets.find((d) => d.id === active) ?? null) : null;
      const selected = (ws.selectedIds ?? []).filter((id) => datasets.some((d) => d.id === id));
      // L0.25: the [active] fallback below is a store-level synthesis with
      // no basis in the doc — a non-null librarySelection wins outright.
      const restoredLibrarySelection = ws.librarySelection ?? null;
      // Plot windows (item 7): restore a persisted layout when the doc has one;
      // the document-aware boundary validates it and clamps dead refs. Otherwise (a v1-v6
      // doc with no `plotWindows`, or a genuinely fresh workspace) collapse
      // back to the ≥1-window invariant's single maximized window, bound to
      // the newly-restored active dataset, with a fresh view — unchanged
      // from before item 7.
      const win = mainWindow(active);
      const dsIds = new Set(datasets.map((d) => d.id));
      const migrationWarnings = [...(ws.migrationWarnings ?? [])];
      // skipLayout: an empty `restored` falls through to the fresh-window path.
      const restored = skipLayout
        ? []
        : sanitizeDocumentBackedPlotWindows(ws.plotWindows, dsIds, migrationWarnings);
      const migrationNotice = migrationWarnings[0] ? ` — ${migrationWarnings[0]}${migrationWarnings.length > 1 ? ` (+${migrationWarnings.length - 1} more)` : ""}` : "";
      // Items 11/17: the ≥1-window invariant is specifically ≥1 PLOT window —
      // non-plot kinds (snapshot / worksheet / map) can't hold focus, so a
      // doc whose surviving windows are all non-plot still gets the fresh
      // maximized main window appended; focus then falls back to the first plot window.
      const restoredHasPlot = restored.some((w) => w.kind === "plot");
      const plotWindows = restoredHasPlot ? restored : [...restored, win];
      const focusedWindowId =
        restoredHasPlot &&
        ws.focusedWindowId &&
        plotWindows.some((w) => w.id === ws.focusedWindowId && w.kind === "plot")
          ? ws.focusedWindowId
          : (plotWindows.find((w) => w.kind === "plot") ?? plotWindows[0]).id;
      // A restored layout carries its own PlotView per window — hydrate the
      // FOCUSED one into the live singleton fields immediately so it renders
      // right away, the same "focused window's live view ≡ singletons"
      // invariant `focusWindow`/`closeWindow` already uphold. Null in the
      // legacy/fresh case, so every singleton field below falls through to
      // EXACTLY today's reset (including the errKeys/hiddenChannels smart
      // defaults derived from the active dataset) — zero behavior change
      // when there's no persisted layout to restore.
      const restoredView = restoredHasPlot
        ? hydrateView(plotWindows.find((w) => w.id === focusedWindowId)!.view)
        : null;
      return {
        datasets,
        folders: migrated.folders,
        // MUST be explicit — `set()` merges a PARTIAL state, so omitting this
        // silently leaves the PREVIOUS project's workbooks in place on the
        // newly opened one (a v1-v3 doc has no `workbooks` field at all, and
        // TypeScript won't catch a missing key in an object literal here).
        workbooks: ws.workbooks ?? [],
        expandedFolders: [...new Set([...(ws.expandedFolders ?? []), ...migrated.createdFolderIds])],
        // L0.25/PR E2: restore what THIS doc carries (parseWorkspace already
        // sanitized it), never the PREVIOUS project's stale value.
        librarySelection: restoredLibrarySelection,
        expandedWorkbookIds: ws.expandedWorkbookIds ?? [],
        workbookLastChild: ws.workbookLastChild ?? {},
        activeId: active,
        // item 15: transient UI (like `stageTab`) — a fresh load falls back to activeId.
        worksheetId: null,
        worksheetSelections: {}, // #14: also transient — never round-trips
        // A restored tree selection wins outright, no [active] synthesis.
        selectedIds: restoredLibrarySelection ? [] : selected.length ? selected : active ? [active] : [],
        originFigures: ws.originFigures ?? [], // restored from the .dwk (v2 persists them)
        originFidelity: ws.originFidelity ?? [],
        smartFolders: ws.smartFolders ?? [], // saved queries (item 9) — .dwk persists them
        reports: ws.reports ?? [], // report sheets (#36) — .dwk v2 persists them
        openReportId: null,
        macroSteps: ws.macroSteps ?? [], // typed pipeline (#6) — .dwk v3
        recalcMode: ws.recalcMode ?? "auto", // recalc engine (#1) — .dwk v3
        figureDocs: ws.figureDocs ?? [], // figure documents (#12) — .dwk v3
        editableFigures: ws.editableFigures ?? [],
        pages: ws.pages ?? [],
        figureDocSeed: null, figurePublicationSession: null, pageDocSeed: null,
        savedPlotSpecs: ws.savedPlotSpecs ?? [], // named graphs (#11) — .dwk v3
        quickPlotTemplates: ws.quickPlotTemplates ?? [], // Quick Plot templates (PR H) — .dwk v4 additive
        savedRois: ws.savedRois ?? [], // named ROIs (RSM_CUTS_PLAN #13) — .dwk v3
        collections: ws.collections ?? [], // saved-search Collections (PR L, L0.48/L0.49) — .dwk v4 additive
        // P1.3 wave 2 (Lane B/C integration fix): `plotRecipes` was already
        // serialized by the whole-state-spread save path (workspaceIO.ts /
        // useWorkspaceAutosave.ts) but never restored here — a load silently
        // dropped every saved recipe AND, worse, left the PREVIOUS project's
        // live list in place (the same cross-project-leak class `workbooks`
        // above calls out). MUST be explicit, same reasoning.
        plotRecipes: ws.plotRecipes ?? [],
        visibleDetailsColumns: sanitizeVisibleDetailsColumns(ws.visibleDetailsColumns), // PR L slice 2 — .dwk v4 additive
        activePlotSpecId: null, // transient binding — a fresh load never resumes mid-edit
        quickFigureBuilderDatasetId: null, // transient UI (like worksheetId) — never resumes on a fresh load
        separatePreview: null, // PR J transient dialog state — never resumes on a fresh load
        // L0.33: transient staging/report state — never resumes on a fresh
        // load, same class as separatePreview above (a stale row would name
        // a dataset id from the PREVIOUS project).
        reimportAllRows: null,
        reimportAllBusy: false,
        // P1.3 wave 2: transient preview/confirm state for a staged recipe
        // apply — never resumes on a fresh load, same as separatePreview/
        // quickFigureBuilderDatasetId above (a stale pending would confirm
        // against whatever dataset happens to share its id in the NEW project).
        pendingRecipeApplication: null,
        staleDatasets: [],
        staleFits: [],
        stageTab: activeDs ? nextStageTab(activeDs, s.stageTab) : s.stageTab,
        xKey: restoredView ? restoredView.xKey : null,
        yKeys: restoredView ? restoredView.yKeys : null,
        groupKey: restoredView ? restoredView.groupKey : null,
        y2Keys: restoredView ? restoredView.y2Keys : null,
        y2Lim: restoredView ? restoredView.y2Lim : null,
        y2Scale: restoredView ? restoredView.y2Scale : null,
        y2Step: restoredView ? restoredView.y2Step : null,
        y2AxisLabel: restoredView ? restoredView.y2AxisLabel : "",
        seriesStyles: restoredView ? restoredView.seriesStyles : {},
        seriesLabels: restoredView ? restoredView.seriesLabels : {},
        errKeys: restoredView ? restoredView.errKeys : activeDs ? defaultErrKeys(activeDs.data) : {},
        seriesOrder: restoredView ? restoredView.seriesOrder : null,
        hiddenChannels: restoredView
          ? restoredView.hiddenChannels
          : activeDs
            ? originHiddenChannels(activeDs.data)
            : [],
        xLim: restoredView ? restoredView.xLim : null,
        yLim: restoredView ? restoredView.yLim : null,
        xStep: restoredView ? restoredView.xStep : null,
        yStep: restoredView ? restoredView.yStep : null,
        fitOverlay: null,
        peakOverlay: null,
        baselineOverlay: null,
        peakWizardEdit: null,
        // NOT baselineAnchorEdit: the useBaseline hook owns it and re-pushes
        // (with a cleared anchor list) on dataset change — nulling it here
        // would fight that effect's cleanup ordering.
        // `composition` (#54, ephemeral) + rsmPeaks..gadgetCursorResult — the
        // SAME transient-tool clear a dataset/focus switch applies elsewhere
        // (windows.ts's `focusTransientReset`); one field list to maintain.
        ...focusTransientReset(),
        // PLOT_WORKFLOW_PLAN item 5: additive — absent on a pre-item-5 .dwk
        // sanitizes to {} (lib/workspace.ts's own undefined-input path).
        techniqueViewMemory: sanitizeTechniqueViewMemory(ws.techniqueViewMemory),
        plotWindows,
        focusedWindowId,
        // #10 item 3: viewport-clamped by parseWorkspace. skipLayout: OMIT
        // the key so `set()`'s merge leaves the layout untouched.
        ...(skipLayout ? {} : { toolWindowLayout: ws.toolWindowLayout ?? {} }),
        // The rest of the PlotView cluster (item 7) — only touched when
        // restoring an actual persisted layout; the legacy/fresh path never
        // wrote these here before item 7, so they're left alone (whatever the
        // pre-load session had) exactly as before. `restoredView` is exactly
        // the VIEW_KEYS set (hydrateView) and the store is a superset, so this
        // spread writes the identical field set the group above re-lists on the
        // restore path — one place to maintain as PlotView grows, not two.
        ...(restoredView ?? {}),
        status: `loaded workspace — ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}${migrationNotice}`,
      };
    }),
  appendWorkspace: (ws) => runAppendWorkspace(set, get, ws),
  setActive: (id) => {
    // Item 14 pin opt-out: a pinned focused window never follows a passive
    // plot intent — retarget it first (focus swap, or a fresh window), then
    // the normal focused-window rebind below lands on the new focus. The
    // rebind itself lives in `focusedRebindPatch` (hoisted, module level) so
    // `rebindWindow`'s explicit-drop path shares it verbatim.
    retargetPassiveRebind(get(), id);
    set((s) => focusedRebindPatch(s, id));
    // ORIGIN_FILE_DECODE_PLAN #38: a plain click covers the common "activate
    // a lazy book" path; the render-side hooks (PlotStage/WindowCanvas/
    // MultiPanelStage/WorksheetPane) cover the rest (multi-panel siblings,
    // whatever `addDataset` left active after a bulk import, a .dwk reload).
    get().ensureBookData(id);
  },
  // WORKSHEET_PLAN item 15 ("origin book click opens…" — owner: "clicking the
  // books tries to plot it all rather than open a spreadsheet like in
  // Origin"). An Origin-project dataset (`isOriginBookDataset`) routes to a
  // worksheet-intent activation — under the default pref: just switches the
  // Worksheet tab to `id` and collapses the row selection, WITHOUT touching
  // `activeId`, `plotWindows`, or any of the singleton view fields (Origin's
  // own model: opening a workbook never touches your graphs). Everything
  // else (a non-Origin dataset, or the pref set to "plot") falls through to
  // `setActive` — the unconditional plot-intent activation, unchanged.
  activateFromLibrary: (id) => {
    const s = get();
    const ds = s.datasets.find((d) => d.id === id);
    if (ds && isOriginBookDataset(ds) && s.originBookClickOpens === "worksheet") {
      set({
        worksheetId: id,
        selectedIds: [id], // plain click collapses the selection, same as setActive
        stageTab: "worksheet", librarySelection: null, // L0.25: also exits folder/workbook selection
      });
      // #38: WorksheetPane's own pending-effect covers the render-side
      // fetch once mounted; kick it here too (single-flight — harmless if
      // it's already in flight) so Library/Inspector consumers keying off
      // `pending` update without waiting for a mount.
      get().ensureBookData(id);
      return;
    }
    get().setActive(id);
  },
  // Ctrl/Cmd-click: add or remove a row from the multi-selection WITHOUT changing
  // the plotted/active dataset (the plot only follows a plain click).
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
      librarySelection: null, // L0.25: also exits folder/workbook selection (selectRange/setActive do the same)
    })),
  // Shift-click: select the contiguous range from the anchor (activeId) to `id`
  // in library order. Doesn't move the active selection (the plot stays put).
  selectRange: (id) =>
    set((s) => {
      const order = s.datasets.map((d) => d.id);
      const anchor = s.activeId ?? id;
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      if (a < 0 || b < 0) return { selectedIds: [id], librarySelection: null };
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { selectedIds: order.slice(lo, hi + 1), librarySelection: null };
    }),
  // Explicit-list selection (folder "Select all" — item 8): de-duplicated and
  // clamped to live datasets; the plotted/active dataset stays put.
  selectIds: (ids) =>
    set((s) => {
      const live = new Set(s.datasets.map((d) => d.id));
      const selectedIds = [...new Set(ids)].filter((id) => live.has(id));
      // L0.25 coherence chokepoint (like activateFromLibrary/toggleSelected):
      // a live dataset selection displaces the tree's librarySelection.
      return { selectedIds, ...(selectedIds.length > 0 ? { librarySelection: null } : {}) };
    }),
  // DELEGATES to removeDatasets (like removeSelected below) rather than
  // repeating its ~25 lines of reference pruning — the single-id path had
  // drifted into its own near-identical copy of the same block; this was the
  // fourth copy removeSelected's own delegation was meant to head off. The
  // only observable difference is the recordHistory label ("remove datasets"
  // instead of "remove dataset"), which no test asserts on.
  removeDataset: (id) => get().removeDatasets([id]),
  // Delete key: remove every selected dataset (falling back to the active one
  // if nothing is multi-selected); reselect the first survivor so the plot
  // recovers. DELEGATES to removeDatasets rather than repeating its ~25 lines
  // of reference pruning (origin figures, fidelity, reports, figure docs, plot
  // windows) — that block had drifted into three near-identical copies, and a
  // new prune target had to be remembered in all of them. The only behaviour
  // this adds on top is the reselect.
  removeSelected: () => {
    const s = get();
    const ids = s.selectedIds.length ? s.selectedIds : s.activeId ? [s.activeId] : [];
    if (ids.length === 0) return;
    get().removeDatasets(ids);
    const activeId = get().activeId;
    set({ selectedIds: activeId ? [activeId] : [] });
  },
  // Bulk-remove by explicit id list (item 17's "manage books" dialog) — unlike
  // removeSelected, this doesn't touch/depend on the transient row selection.
  removeDatasets: (ids) => {
    get().recordHistory("remove datasets");
    get().sendToTrash(get().datasets.filter((d) => ids.includes(d.id))); // #32 trash
    set((s) => removeDatasetsPatch(s, ids)); // shared with deleteWorkbook — see store/removeDatasets.ts
  },

  // Wipe the entire library. Reuses loadWorkspace's "replace everything" reset
  // (clears per-dataset view state, overlays, styles, folders, figures) with an
  // empty workspace, so nothing stale survives; autosave self-clears on the
  // resulting empty-datasets state.
  clearAll: () => {
    get().recordHistory("remove all");
    get().loadWorkspace({
      datasets: [],
      folders: [],
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      originFidelity: [],
      reports: [],
      figureDocs: [],
      editableFigures: [],
    });
    set({ status: "removed all datasets, folders, figures, and reports" });
  },

  // Concatenate the selected datasets (in selection order) row-wise into one new
  // library dataset. Needs ≥2 with a matching column count (mergeDatasets guards).
  mergeSelected: async () => {
    const s = get();
    const pickIds = s.selectedIds.filter((id) => s.datasets.some((d) => d.id === id));
    if (pickIds.length < 2) {
      get().setStatus("select ≥2 datasets to merge");
      return;
    }
    try {
      // #38 deferred edge: any of the selected datasets can be a never-
      // activated, still-pending Origin book — resolve them all first
      // (bounded concurrency) rather than silently merging previews.
      const picks = await get().resolveDatasets(pickIds);
      if (picks.length < 2) {
        get().setStatus("select ≥2 datasets to merge");
        return;
      }
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
  duplicateDataset: async (id) => {
    await get().resolveDataset(id);
    get().recordHistory("duplicate dataset");
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
        worksheetId: null, // item 15: the clone becomes the plot AND worksheet target
        selectedIds: [clone.id],
        librarySelection: null, // L0.25 coherence (retrospective-audit fix)
        stageTab: nextStageTab(clone, s.stageTab),
        xKey: null,
        yKeys: null,
        groupKey: null,
        y2Keys: null,
      y2Lim: null,
      y2Scale: null,
      y2Step: null,
      y2AxisLabel: "",
        seriesStyles: {},
        errKeys: {},
        hiddenChannels: [],
        xLim: null,
        yLim: null,
        xStep: null,
        yStep: null,
        composition: null, // #54 — the clone becomes active, not an arrangement
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
    });
  },
  // Reorder the library by swapping a dataset with its neighbor (dir -1 = up,
  // +1 = down). No-op at the ends or for an unknown id. Order drives the list and
  // the consolidated-export column order; the active selection is unaffected.
  moveDataset: (id, dir) => {
    get().recordHistory("reorder datasets");
    set((s) => {
      const i = s.datasets.findIndex((d) => d.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.datasets.length) return {};
      const datasets = [...s.datasets];
      [datasets[i], datasets[j]] = [datasets[j], datasets[i]];
      return { datasets };
    });
  },
  renameDataset: (id, name) => {
    get().recordHistory("rename dataset");
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, name: name.trim() || d.name } : d,
      ),
    }));
  },
  // Edit a single worksheet cell in place (col < 0 = the x/time column). Rebuilds
  // the dataset's arrays immutably (DataStruct stays frozen-by-contract) so the
  // plot + stats recompute live. Computed columns (the last `formulas.length`)
  // are read-only — a recompute would overwrite them — so an edit there is a
  // no-op. Editing a base cell recomputes the computed columns. Recovery of the
  // original is via Duplicate.
  // addFormula/removeFormula/updateFormula live on ComputedColumnsSlice
  // (store/computedColumns.ts) — see AppState's extends list.
  // ── Folder tree (project-organization plan item 1) ──────────────────────
  // All five delegate to the pure lib/foldertree ops; the store only supplies
  // ids and threads state. deleteFolder re-homes datasets (never destroys them).
  createFolder: (parentId, name = "New Folder") => {
    const id = nextFolderId();
    get().recordHistory("create folder");
    set((s) => ({ folders: treeCreateFolder(s.folders, parentId, name, id) }));
    return id;
  },
  renameFolder: (id, name) => (get().recordHistory("rename folder"), set((s) => ({ folders: treeRenameFolder(s.folders, id, name) }))),
  deleteFolder: (id, mode = "reparent") => (get().recordHistory("delete folder"), set((s) => folderDeletePatch(s, id, mode))),
  moveFolder: (id, newParentId, beforeId) => (get().recordHistory("move folder"), set((s) => ({ folders: treeMoveFolder(s.folders, id, newParentId, beforeId) }))),
  moveDatasetToFolder: (id, folderId, beforeId) => (get().recordHistory("move dataset"), set((s) => ({ datasets: treeMoveDatasetToFolder(s.datasets, id, folderId, beforeId) }))),
  toggleFolderExpanded: (id) =>
    set((s) => ({
      expandedFolders: s.expandedFolders.includes(id)
        ? s.expandedFolders.filter((x) => x !== id)
        : [...s.expandedFolders, id],
    })),

  // ── Smart folders (project-organization plan item 9) ────────────────────
  // Saved queries, nothing else — members are derived per render by
  // lib/smartfolders, so there is no membership state to keep in sync.
  addSmartFolder: (name, query) => {
    if (!name.trim()) return;
    get().recordHistory("add smart folder");
    set((s) => {
      const nm = name.trim();
      return {
        smartFolders: [
          ...s.smartFolders,
          { id: `smf-${Date.now().toString(36)}-${++_idSeq}`, name: nm, query: query.trim() },
        ],
      };
    });
  },
  updateSmartFolder: (id, name, query) => (get().recordHistory("edit smart folder"), set((s) => ({
      smartFolders: s.smartFolders.map((f) =>
        f.id === id ? { ...f, name: name.trim() || f.name, query: query.trim() } : f,
      ),
    }))),
  removeSmartFolder: (id) => (get().recordHistory("remove smart folder"), set((s) => ({ smartFolders: s.smartFolders.filter((f) => f.id !== id) }))),
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
  setYScale: (yScale) => {
    get().recordHistory("change Y scale"); set({ yScale });
    get().recordMacro(`Y axis ${yScale}`, `qz.setYScale(${lit(yScale)})`);
  },
  setXScale: (xScale) => {
    get().recordHistory("change X scale"); set({ xScale });
    get().recordMacro(`X axis ${xScale}`, `qz.setXScale(${lit(xScale)})`);
  },
  setShowGrid: (showGrid) => { get().recordHistory("toggle grid"); set({ showGrid }); },
  setShowLegend: (showLegend) => { get().recordHistory("toggle legend"); set({ showLegend }); },
  setLegendPos: (legendPos) => { get().recordHistory("move legend"); set({ legendPos }); },
  setLegendStatic: (legendStatic) => { get().recordHistory("change legend mode"); set({ legendStatic }); },
  setPlotTemplate: (plotTemplate) => { get().recordHistory("apply plot template"); set({ plotTemplate }); },
  setShowAxisBox: (showAxisBox) => { get().recordHistory("toggle axis box"); set({ showAxisBox }); },
  // A manual toggle (on OR off) always drops any spatial arrangement from a
  // prior Origin multi-panel apply, or a prior facet-by-column arrangement
  // (gap #21 residual) — the plain per-channel split (or leaving stack mode)
  // is what the user asked for, never a stale spatial/facet grid.
  setStackMode: (stackMode) => (get().recordHistory("change plot layout"), set({ stackMode, composition: null })),
  // #54: the spatial multi-panel fit mode (PlotView field). `cyclePanelFit`
  // advances frames<->window until a page model exists (Stage 2 opens page).
  setPanelFit: (panelFit) => { get().recordHistory("change panel fit"); set({ panelFit }); },
  cyclePanelFit: () => { get().recordHistory("change panel fit"); set((s) => ({ panelFit: nextPanelFit(s.panelFit, s.pageSetup != null) })); },
  setPageSetup: (pageSetup) => { get().recordHistory("change page setup"); set({ pageSetup }); },
  setInsetMode: (insetMode) => { get().recordHistory("toggle inset"); set({ insetMode }); },
  setPolarMode: (polarMode) => { get().recordHistory("toggle polar plot"); set({ polarMode }); },
  setStatMode: (statMode) => { get().recordHistory("toggle statistics plot"); set({ statMode }); },
  // Clears the paired decoded step too: a manual/Inspector range (or the
  // smart auto-scale reset to null) is no longer the Origin figure that
  // produced xStep/yStep, so a stale step must never leak onto it.
  setXLim: (xLim) => set({ xLim, xStep: null }),
  setYLim: (yLim) => set({ yLim, yStep: null }),
  // A manual y2 range is no longer the Origin figure that decoded y2Step, so
  // drop the stale step alongside it (mirrors setYLim / yStep above).
  setY2Scale: (y2Scale) => { get().recordHistory("change Y2 scale"); set({ y2Scale }); },
  setY2Lim: (y2Lim) => { get().recordHistory("change Y2 limits"); set({ y2Lim, y2Step: null }); },
  setXFmt: (xFmt) => { get().recordHistory("format X axis"); set({ xFmt }); },
  setYFmt: (yFmt) => { get().recordHistory("format Y axis"); set({ yFmt }); },
  setY2Fmt: (y2Fmt) => { get().recordHistory("format Y2 axis"); set({ y2Fmt }); },
  setPlotTitle: (plotTitle) => {
    get().recordHistory("edit plot title"); set({ plotTitle });
    get().recordMacro(`Title → ${plotTitle || "(none)"}`, `qz.setPlotTitle(${lit(plotTitle)})`);
  },
  setXAxisLabel: (xAxisLabel) => { get().recordHistory("edit X axis title"); set({ xAxisLabel }); },
  setYAxisLabel: (yAxisLabel) => { get().recordHistory("edit Y axis title"); set({ yAxisLabel }); },
  setY2AxisLabel: (y2AxisLabel) => { get().recordHistory("edit Y2 axis title"); set({ y2AxisLabel }); },
  setXKey: (xKey) => {
    get().recordHistory("change X channel"); set({ xKey });
    get().recordMacro(`X axis → channel ${xKey ?? "time"}`, `qz.setXKey(${lit(xKey)})`);
  },
  // P1.5: durable live grouping -- committed by useGraphBuilder's commitToPlot
  // (replacing the old "preview-only" toast) and editable directly once a
  // window exists. Mirrors setXKey exactly (undo history + macro record);
  // syncPlotWindow/updateFigureDocumentFromPlotView (windowDocuments.ts /
  // figureDocument.ts) then carry this singleton into the focused window's
  // canonical FigureDocument on the next view sync, same as every other
  // PlotView field.
  setGroupKey: (groupKey) => {
    get().recordHistory("change group");
    set({ groupKey });
    get().recordMacro(`Group by channel ${groupKey ?? "none"}`, `qz.setGroupKey(${lit(groupKey)})`);
  },
  setYKeys: (yKeys) => {
    get().recordHistory("change Y channels"); set({ yKeys });
    get().recordMacro(`Y channels → ${yKeys ? yKeys.join(",") : "all"}`, `qz.setYKeys(${lit(yKeys)})`);
  },
  setY2Keys: (y2Keys) => {
    get().recordHistory("change Y2 channels");
    set({ y2Keys, ...(y2Keys ? {} : { y2Lim: null, y2Scale: null, y2Step: null, y2AxisLabel: "" }) });
    get().recordMacro(
      `Y2 channels → ${y2Keys ? y2Keys.join(",") : "none"}`,
      `qz.setY2Keys(${lit(y2Keys)})`,
    );
  },
  addRefLine: (axis, value) => { get().recordHistory("add reference line"); set((s) => ({ refLines: [...s.refLines, { id: `ref-${++_refSeq}`, axis, value }] })); },
  removeRefLine: (id) => { get().recordHistory("delete reference line"); set((s) => ({ refLines: s.refLines.filter((r) => r.id !== id) })); },
  // Move a reference line to a new value (drag commit). No-op for an unknown id.
  updateRefLine: (id, value) => { get().recordHistory("move reference line"); set((s) => ({ refLines: s.refLines.map((r) => (r.id === id ? { ...r, value } : r)) })); },
  // Returns the new id (MAIN #27's "text box" flyout opens its text dialog).
  addAnnotation: (x, y, text) => {
    const id = `ann-${++_annSeq}`;
    get().recordHistory("add annotation");
    set((s) => ({ annotations: [...s.annotations, { id, x, y, text }] }));
    return id;
  },
  removeAnnotation: (id) => { get().recordHistory("delete annotation"); set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })); },
  setSeriesStyle: (channel, patch) => (get().recordHistory("style curve"),
    set((s) => ({
      seriesStyles: { ...s.seriesStyles, [channel]: { ...s.seriesStyles[channel], ...patch } },
    }))),
  resetSeriesStyle: (channel) => (get().recordHistory("reset curve style"),
    set((s) => {
      const next = { ...s.seriesStyles };
      delete next[channel];
      return { seriesStyles: next };
    })),
  // Rename a channel's legend/series label. Blank (or whitespace) clears the
  // override, reverting to the dataset's own label.
  setSeriesLabel: (channel, label) => (get().recordHistory("rename curve"),
    set((s) => {
      const next = { ...s.seriesLabels };
      const t = label.trim();
      if (t) next[channel] = t;
      else delete next[channel];
      return { seriesLabels: next };
    })),
  setErrKey: (channel, errChannel) => (get().recordHistory("change error bars"),
    set((s) => {
      const next = { ...s.errKeys };
      if (errChannel == null) delete next[channel];
      else next[channel] = errChannel;
      return { errKeys: next };
    })),
  // Set (or clear, role=null) a column role on the ACTIVE dataset. Roles live on
  // the dataset (persist across switches + round-trip .dwk); the map empties to
  // undefined to keep saved files clean.
  setChannelRole: (channel, role) => {
    const id = get().activeId;
    if (id == null) return;
    get().recordHistory("channel role");
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
  // Set (or clear, t=null) a modeling-type OVERRIDE on dataset `id`. Takes an
  // EXPLICIT id (P1.6b: the worksheet's own C/O/N header badge is the first
  // caller that isn't always the active dataset — GUI_INTERACTION #14's
  // floating worksheet window can browse a NON-active one) rather than
  // `get().activeId` — overrides live on the dataset (persist across
  // switches + round-trip .dwk); absent = auto-inference (lib/modeling).
  setChannelType: (id, channel, t) => {
    if (!get().datasets.some((d) => d.id === id)) return;
    get().recordHistory("channel type");
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
  toggleRowExcluded: (id, row) => {
    get().recordHistory("row exclusion");
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const next = toggleExcluded(d.excludedRows, row);
        return { ...d, excludedRows: next.length ? next : undefined };
      }),
    }));
  },
  setRowsExcluded: (id, rows) => {
    get().recordHistory("row exclusion");
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const clean = sanitizeExcluded(rows, d.data.time.length);
        return { ...d, excludedRows: clean.length ? clean : undefined };
      }),
    }));
  },
  clearRowExclusions: (id) => {
    get().recordHistory("clear row exclusions");
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, excludedRows: undefined } : d,
      ),
    }));
  },
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
  excludeSelectedRows: (windowId) => {
    const sel = worksheetOrActiveSelection(get(), windowId);
    if (!sel?.rows.length) return;
    get().recordHistory("row exclusion");
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === sel.datasetId ? { ...d, excludedRows: mergeExcluded(d.excludedRows, sel.rows) } : d,
      ),
    }));
    if (windowId) get().clearWorksheetRowSelection(windowId);
    else set({ selection: null });
  },
  keepOnlySelectedRows: (windowId) => {
    const sel = worksheetOrActiveSelection(get(), windowId);
    if (!sel?.rows.length) return;
    get().recordHistory("row exclusion");
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === sel.datasetId ? { ...d, excludedRows: keepOnlyExcluded(sel.rows, d.data.time.length) } : d,
      ),
    }));
    if (windowId) get().clearWorksheetRowSelection(windowId);
    else set({ selection: null });
  },
  // Persist an explicit plotted-channel draw order (a permutation of the current
  // plotted channels). effectiveChannels reorders by it; stale entries (channels
  // no longer plotted) are ignored and newly-plotted channels append in order.
  setSeriesOrder: (seriesOrder) => { get().recordHistory("reorder curves"); set({ seriesOrder }); },
  toggleHidden: (channel) => {
    get().recordHistory("toggle curve visibility");
    set((s) => ({
      hiddenChannels: s.hiddenChannels.includes(channel)
        ? s.hiddenChannels.filter((c) => c !== channel)
        : [...s.hiddenChannels, channel],
    }));
  },
  // Solo = hide every plotted channel except `channel` (the column switcher's
  // engine). null clears. View state like toggleHidden — not macro-recorded.
  soloChannel: (channel) => {
    get().recordHistory("solo curve");
    set((s) => {
      if (channel == null) return { hiddenChannels: [] };
      const ds = s.datasets.find((d) => d.id === s.activeId);
      if (!ds) return {};
      const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
      if (!plotted.includes(channel)) return {};
      return { hiddenChannels: plotted.filter((c) => c !== channel) };
    });
  },
  setWaterfall: (waterfall) => {
    get().recordHistory("change waterfall offset");
    set({ waterfall });
    get().recordMacro(`Waterfall → ${waterfall}`, `qz.setWaterfall(${waterfall})`);
  },
  // (the window-management action implementations moved to store/windows.ts —
  // composed via createWindowsSlice at the top of this literal.)
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
    // Durable fit spec (audit P1 #3): records the plotted channels the gadget
    // fit (first visible plotted channel + xKey), reused as the step params so
    // a template batch replays those channels, not time/values[0]. The ROI only
    // shaped which rows the user previewed (preview-only — never encoded).
    const spec = qfitSpec(active, s, s.qfitModel, s.qfitResult);
    get().recordMacro(`Fit ${s.qfitModel}`, `qz.fit(${lit(s.qfitModel)})`, {
      kind: "fit",
      params: fitStepParams(s.qfitModel, spec),
    });
    get().setFitSpec(active.id, spec);
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
  addFigureDoc: (doc) => set((s) => ({
    figureDocs: [...s.figureDocs, doc], status: `figure "${doc.name}" saved`,
  })),
  removeFigureDoc: (id) => set((s) => ({ figureDocs: s.figureDocs.filter((f) => f.id !== id) })),
  renameFigureDoc: (id, name) => set((s) => ({
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
  openFigureDraft: (doc) => {
    if (get().figurePublicationSession) { toast("finish or cancel the current Publication Preview first", "danger"); set({ status: "finish or cancel the current Publication Preview first" }); return; } if (!doc || !docRenderable(doc, new Set(get().datasets.map((dataset) => dataset.id)))) return;
    if (doc.live && doc.datasetId) get().setActive(doc.datasetId);
    set({ figureDocSeed: doc, figureBuilderOpen: true });
  },
  openFigureDoc: (id) => {
    const doc = get().figureDocs.find((f) => f.id === id);
    if (doc) get().openFigureDraft(doc);
  },
  // Item 9's figure-doc half: a live doc only (a frozen doc's snapshot isn't
  // a live `Dataset` a window can bind to — that gap is Tier 3 item 11's
  // "snapshot-as-window"). Creates + focuses a new window bound to the doc's
  // dataset, then applies the config's channel/scale/label fields — NOT its
  // `seriesStyles` (a `FigureConfig` carries the EXPORT style shape,
  // `ExportSeriesStyle[]`, which has no inverse back to the live
  // `Record<number,SeriesStyle>`; the window opens with default series styling.
  openFigureDocInWindow: (id) => {
    const doc = get().figureDocs.find((f) => f.id === id);
    if (!doc || !doc.live || !doc.datasetId) return;
    const s = get();
    if (!s.datasets.some((dataset) => dataset.id === doc.datasetId)) return;
    const title = dedupeWindowTitle(
      doc.name,
      s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
    );
    const winId = s.createWindow(doc.datasetId, undefined, title);
    s.focusWindow(winId);
    const c = doc.config;
    const targetDs = s.datasets.find((d) => d.id === doc.datasetId);
    set((current) => ({
      // Plot-intent (item 1): "open in new window" always means look at the
      // plot, so surface it regardless of which tab was showing.
      ...(targetDs ? { stageTab: plotIntentStageTab(targetDs) } : {}),
      xKey: c.xKey,
      yKeys: c.yKeys,
      // P1.5: a legacy FigureDoc's own grouping (Graph Builder's
      // plotSpecToFigureDoc is the only producer) now carries over into the
      // opened window's live groupKey too, same as xKey/yKeys just above --
      // previously this whole binding was silently dropped on "open in window".
      groupKey: c.groupCol ?? null,
      xScale: c.xScale,
      yScale: c.yScale,
      plotTitle: c.title,
      xAxisLabel: c.xLabel,
      yAxisLabel: c.yLabel,
      // Item 3: the doc's own error bindings, if any (else createWindow's dataset-seeded errorRoles stand).
      ...(c.errors ? withWindowDocumentErrors(current.plotWindows, winId, c.errors) : {}),
    }));
    get().recordMacro(`Open figure "${doc.name}" in new window`, `qz.openFigureDocInWindow(${lit(id)})`);
  },
  clearFigureDocSeed: () => set({ figureDocSeed: null }),
  // ── Recalc engine (#1; K3/K5c/K5d generalize it over derived worksheets) ──
  // `downstreamOf` (lib/recalc.ts) now walks the WIDENED ds/col/sheet/fit
  // graph internally, so a dataset with `derivedFrom` set (K2, L0.50) already
  // lands in `down.datasets`/`down.fits` here exactly like a bgRef-chained
  // one — no separate sheet-marking path needed. That satisfies K5c's "no
  // automatic recompute on source edit beyond stale-marking" for free: this
  // action only ever ADDS ids to `staleDatasets`/`staleFits`, never mutates
  // data, whether the auto-mode debounce below fires or not. `recalcNow`
  // below is the actual "async stale-marked scheduler path" a sheet
  // recalculates through — today a stale sheet with no `corrections` simply
  // clears (the honest no-op: no pipeline EXECUTOR exists yet, that's
  // LIBRARY_WORKBOOK_UX_PLAN PR K slice 2), and because `down.fits` was
  // populated from the SAME graph walk, a downstream fit on a sheet is
  // already stale in this SAME call — recalcNow's existing two-phase order
  // (datasets, then `recomputeStaleFits`) processes a ds→sheet→fit chain in
  // the right order inside one pass without further changes here.
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
      // PR K slice 2 (K5c/K5d "real executor"): a derived worksheet (K2)
      // recomputes through its OWN pipeline-against-source executor, never
      // the plain bgRef/corrections path below — checked FIRST since a
      // derived sheet also carries `.corrections`/`.raw` (its pipeline
      // recipe + a cache of the SOURCE's data), which would otherwise match
      // the generic branch and silently re-run against its own stale cache
      // instead of the source's current data.
      for (const id of [...get().staleDatasets]) {
        const d = get().datasets.find((x) => x.id === id);
        if (d?.derivedFrom) {
          try {
            const updated = await recomputeDerivedSheet(get, d);
            // #50/#53 guard (P1-2 review fix): a row-count-changing recompute
            // invalidates excludedRows + the four overlays — the SAME shared
            // helper applyCorrections uses, so the two call sites can't drift.
            const rowsChanged = updated.data.time.length !== d.data.time.length;
            let statusMsg: string | undefined;
            set((s) => {
              const guard = rowsChangedGuard(s, id, rowsChanged, d.excludedRows);
              statusMsg = guard.statusMessage;
              return {
                datasets: s.datasets.map((x) => (x.id === id ? { ...updated, ...guard.datasetPatch } : x)),
                staleDatasets: s.staleDatasets.filter((x) => x !== id),
                ...guard.statePatch,
              };
            });
            if (statusMsg) get().setStatus(statusMsg);
          } catch (e) {
            get().setStatus(`derived worksheet recompute failed: ${e instanceof Error ? e.message : "error"}`);
            /* stays stale */
          }
        } else if (d?.corrections && d.raw) {
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
      await recomputeStaleFits(set, get);
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
  setFigurePageOpen: (figurePageOpen) => set({ figurePageOpen }),
  seedStatStage: (statStageSeed) => set({ statStageSeed, statMode: true }),
  clearStatStageSeed: () => set({ statStageSeed: null }),
  setWaterfallOpen: (waterfallOpen) => set({ waterfallOpen }),
  setReflViewOpen: (reflViewOpen) => set({ reflViewOpen }),
  setColumnSwitcherOpen: (columnSwitcherOpen) => set({ columnSwitcherOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setTextFormatHelpOpen: (textFormatHelpOpen) => set({ textFormatHelpOpen }),
  setMagToolsOpen: (magToolsOpen) => set({ magToolsOpen }),
  setFitOverlay: (fitOverlay) => set({ fitOverlay }),
  setPeakOverlay: (peakOverlay) => set({ peakOverlay }),
  setBaselineOverlay: (baselineOverlay) => set({ baselineOverlay }),
  setPeakWizardEdit: (peakWizardEdit) => set({ peakWizardEdit }),
  setBaselineAnchorEdit: (baselineAnchorEdit) => set({ baselineAnchorEdit }),
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
