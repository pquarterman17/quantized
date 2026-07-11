// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.

import { create } from "zustand";

import type { CorrectionsRequest, FftSpectralResult, IntegrateResponse } from "../lib/api";
import {
  applyCorrections as applyCorrectionsApi,
  fetchBookData,
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
  migrateGroupsToFolders,
  moveDatasetToFolder as treeMoveDatasetToFolder,
  moveFolder as treeMoveFolder,
  renameFolder as treeRenameFolder,
} from "../lib/foldertree";
import { isOriginBookDataset } from "../lib/grouping";
import { mergeDatasets } from "../lib/merge";
import type { SmartFolder } from "../lib/smartfolders";
import { serializeWorkspace, type WorkspaceState } from "../lib/workspace";
import { saveBlob } from "../lib/download";
import {
  buildOriginFigureEntries,
  doubleYPartner,
  figureChannelSelection,
  figureLabel,
  figureLayerFamily,
  originFigureAnnotations,
  originLegendPos,
  originRegionShades,
  resolveSpatialPanels,
  type OriginFigureEntry,
} from "../lib/originFigures";
import { planOriginFolders } from "../lib/originFolders";
import {
  dedupeWindowTitle,
  displayedWindowTitle,
  hydrateView,
  sanitizePlotWindows, scaleFromLog,
} from "../lib/plotview";
import { nextStageTab, plotIntentStageTab, type StageTab } from "../lib/stagetab";
// The MDI window-management slice (MAIN_PLAN #2): state + actions live in
// ./windows and are composed into THIS store instance below; the shared
// rebind helpers are imported back for setActive/addDataset/loadWorkspace.
import {
  createWindowsSlice,
  datasetViewDefaults,
  focusedRebindPatch,
  mainWindow,
  retargetPassiveRebind,
  type WindowsSlice,
} from "./windows";
// The undo/redo snapshot-history slice (MAIN_PLAN #9), composed the same way.
import { createHistorySlice, type HistorySlice } from "./history";
import type { SpatialPanel } from "../lib/multipanel";
import { breakPayloads, facetPayloads, suggestBreaks, type BreakPanel, type FacetPanel } from "../lib/facet";
import { pruneReportRefs, type ReportEntry, type ReportSheet } from "../lib/report";
import { buildOverlayDataset, overlayCurveLabels, overlayCurveStyles } from "../lib/originOverlay";
import { applyPalette, normalizePalette } from "../lib/palettes";
import { isActive } from "../lib/datafilter";
import type { FwhmResult } from "../lib/peakwidth";
import { effectiveChannels } from "../lib/plotdata";
import { docRenderable, type FigureDoc } from "../lib/figuredoc";
import type { PlotSpec } from "../lib/plotspec";
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
import { isLazyBookEntry, isPrimaryBookMarker } from "../lib/types";
import type {
  Annotation,
  AxisFormat, AxisScale,
  BaselineOverlay,
  BookSource,
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
  RegionShade,
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
// (window ids: see store/windows.ts — the MDI slice owns its own sequence)

/** In-flight lazy-book fetches (ORIGIN_FILE_DECODE_PLAN #38), single-flight
 *  and keyed by dataset id — a book bound into two places at once (e.g. two
 *  plot windows) triggers exactly one HTTP fetch. Module scope, not store
 *  state: a Promise has no business flowing through Zustand subscribers or
 *  (accidentally) a .dwk serialize. */
const _bookFetches = new Map<string, Promise<void>>();

/** Fetch one dataset's full data and install it, single-flight. Resolves
 *  (not rejects) once the swap lands — `ensureBookData` (fire-and-forget UI
 *  trigger) attaches its own `.catch` for the toast; `resolvePendingDatasets`
 *  (the .dwk pre-save resolver) awaits the SAME promise and lets a failure
 *  propagate so the caller can abort the save. */
function installBookData(id: string, source: BookSource): Promise<void> {
  const inFlight = _bookFetches.get(id);
  if (inFlight) return inFlight;
  const p = fetchBookData(source)
    .then((full) => {
      useApp.setState((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id
            ? {
                ...d,
                data: full,
                pending: undefined,
                // Row-state indices were against the PREVIEW rows (#50/#53)
                // — they no longer mean anything against the real data.
                excludedRows: undefined,
                filter: undefined,
              }
            : d,
        ),
      }));
    })
    .finally(() => {
      _bookFetches.delete(id);
    });
  _bookFetches.set(id, p);
  return p;
}

// (mainWindow / focusTransientReset / datasetViewDefaults / focusedRebindPatch /
// retargetPassiveRebind moved to store/windows.ts with the window slice —
// imported above for the setActive/addDataset/loadWorkspace paths.)

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
  | "excludedDisplay"
  | "originBookClickOpens";

// Exported for the window slice (store/windows.ts), which types its actions
// against the WHOLE composed store — cross-slice reads/writes are the point
// of slice composition (type-only in that direction, so no runtime cycle).
export interface AppState extends WindowsSlice, HistorySlice {
  datasets: Dataset[];
  activeId: string | null;
  // Multi-selection for bulk ops (Delete key). `activeId` stays the plotted
  // "primary"; ctrl/shift-click extend `selectedIds` without changing the plot.
  selectedIds: string[];
  // WORKSHEET_PLAN item 15 ("origin book click opens…"): the Worksheet tab's
  // dataset override, set by `activateFromLibrary`'s worksheet-intent path
  // instead of `activeId` — `activeId` stays the FOCUSED plot window's bound
  // dataset (PlotStage/Inspector/every workshop read `activeId` and MUST
  // keep doing so unchanged, per MULTI_PLOT_PLAN's facade), so switching
  // Worksheet content here can never rebind or reset the plot. null = "no
  // override" — `Worksheet.tsx` falls back to `activeId`, today's behavior.
  // Cleared by `setActive` (any full plot-intent activation drops it — the
  // plot it now shows is the worksheet's again, via the `activeId` fallback).
  worksheetId: string | null;
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
  antialias: boolean;
  sigFigs: number;
  notation: Notation;
  confirmRemove: boolean;
  excludedDisplay: ExcludedDisplay;
  originBookClickOpens: OriginBookClickOpens;
  prefsOpen: boolean;
  yScale: AxisScale; // Y axis scale (MAIN #12: linear/log/reciprocal)
  xScale: AxisScale; // X axis scale
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
  // Facet-by-column (gap #21 residual): set by `facetByColumn` — one
  // small-multiples panel per distinct level of a chosen column, built from
  // the active dataset's ANALYSIS view (guard #11) via `lib/facet.facetPayloads`.
  // A PARALLEL field to `spatialPanels`, not a reuse of it: a spatial panel is
  // a reference (datasetId + xKey/yKeys) MultiPanelStage fetches and gives its
  // OWN fixed axis state, because it can point at a wholly different dataset
  // per panel; a facet panel is a ROW-FILTERED SLICE of ONE dataset that
  // `facetPayloads` already materializes as a `PlotPayload` (no dataset
  // reference to fetch, no per-panel axis state — the whole point of faceting
  // is a SHARED x-domain the render side computes once). Mutually exclusive
  // with `spatialPanels` — every setter that assigns one clears the other.
  facetPanels: FacetPanel[] | null;
  // Paneled x-breaks (gap #21 last residual): set by `breakAtGaps` — one
  // panel per contiguous x-segment implied by a set of axis breaks (a caller
  // override or `lib/facet.suggestBreaks`'s own gap detection), sharing ONE
  // y-domain across every panel (`lib/facet.sharedYDomain`) but each keeping
  // its OWN local x-range (`lib/facet.breakPayloads`). A THIRD parallel field
  // alongside `spatialPanels`/`facetPanels` — mutually exclusive with both
  // (every setter that assigns one clears the other two).
  breakPanels: BreakPanel[] | null;
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
  yFmt: AxisFormat; // Y-axis tick number format (also applied to the secondary axis)
  plotTitle: string; // chart title rendered above the plot ("" = none)
  xAxisLabel: string; // override for the x-axis label ("" = auto from data)
  yAxisLabel: string; // override for the primary y-axis label ("" = auto)
  xKey: number | null; // value channel used as the plot x-axis (null = .time)
  yKeys: number[] | null; // which value channels to plot (null = all)
  y2Keys: number[] | null; // channels drawn on the secondary (right) Y axis
  y2Lim: [number, number] | null; // fixed secondary-Y range (Origin double-Y apply)
  y2Scale: AxisScale | null; // secondary-Y scale (null = inherit yScale)
  y2Step: number | null; // decoded major-tick increment for y2Lim (see xStep/yStep)
  y2AxisLabel: string; // override for the secondary y-axis label ("" = auto)
  refLines: RefLine[]; // fixed X/Y marker lines on the plot
  annotations: Annotation[]; // text labels pinned at data coordinates
  regionShades: RegionShade[]; // Origin Rect* region bands (decode-plan #41), replaced per figure apply
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
  figurePageOpen: boolean; // the multi-panel figure page composer (GOTO #4)
  graphBuilderOpen: boolean; // the drag-columns-to-wells plot-spec builder (#51)
  // One-shot spec handed TO the Graph Builder by the worksheet's "Open in
  // Graph Builder" (MAIN_PLAN #4) — consumed + cleared by useGraphBuilder on
  // open, mirroring statStageSeed's shape. null = open empty (the ⌘K path).
  graphBuilderSeed: PlotSpec | null;
  // One-shot pickers handed from the Graph Builder to the stat stage when a
  // box/violin spec is sent (consumed + cleared by useStatStage). null = none.
  statStageSeed: StatStageSeed | null;
  waterfallOpen: boolean;
  reflViewOpen: boolean;
  columnSwitcherOpen: boolean; // the JMP-style solo-a-channel flipper (#54)
  shortcutsOpen: boolean;
  textFormatHelpOpen: boolean; // Help ▸ Text formatting (GOTO #11)
  // Recent-imports history (File ▸ Recent); persisted via lib/recentFiles.
  recent: RecentFile[];
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  // Peak wizard click-on-plot marker editing (item 5) — see PeakWizardEditBridge.
  peakWizardEdit: PeakWizardEditBridge | null;
  // Anchor-point baseline editing (GOTO #2) — see AnchorEditBridge.
  baselineAnchorEdit: AnchorEditBridge | null;
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
  // Lazy per-book import (ORIGIN_FILE_DECODE_PLAN #38): fire-and-forget fetch
  // of a pending dataset's full data (no-op if it isn't pending, or a fetch
  // for it is already in flight — single-flight, see `installBookData`).
  // Swaps `data` to the fetched full DataStruct and clears `pending` on
  // success; toasts and leaves `pending` set on failure (so the next call —
  // e.g. the user retrying, or simply re-activating the dataset — retries).
  // Call this from any view that's about to READ a dataset's `.data` for
  // real (not just list it): setActive, a plot window binding, a multi-panel
  // cell, the worksheet.
  ensureBookData: (id: string) => void;
  // Awaited version for a caller that needs every pending dataset FULLY
  // resolved before proceeding — the "Save workspace (.dwk)…" command, so an
  // exported .dwk is always self-contained (never references a book by a
  // path/token that may not exist on another machine or after a restart).
  // Rejects if any fetch fails (the caller should abort the save and toast).
  resolvePendingDatasets: () => Promise<void>;
  // Resolve ONE dataset's full data if it's still a lazy-book preview (#38's
  // deferred edge: a compute or export entry point must never silently run
  // on the small preview). No-op — resolves immediately with the dataset
  // as-is — when it isn't pending (or doesn't exist, returning undefined).
  // Toasts only if the fetch is still running past a short grace period (the
  // common cached-parse case resolves in ~20ms, not worth interrupting for).
  // Rejects on fetch failure so the caller's existing error handling (every
  // compute/export entry already has a catch → setError/toast) aborts the
  // operation instead of falling through to the preview.
  resolveDataset: (id: string) => Promise<Dataset | undefined>;
  // Bounded-concurrency batch version of resolveDataset — batch export/
  // folder ops/macro replay can touch dozens of never-activated datasets at
  // once; this caps simultaneous fetches rather than firing them all. Missing
  // ids are silently dropped from the result; a fetch failure rejects (same
  // "abort, don't proceed on a preview" contract as resolveDataset).
  resolveDatasets: (ids: string[]) => Promise<Dataset[]>;
  // "Save workspace (.dwk)…" (App.tsx's File menu command): resolves every
  // pending lazy book first (see `resolvePendingDatasets`'s doc), then
  // serializes + downloads. Owns its own status/toast messaging so the
  // command itself stays a thin `run: () => s().saveWorkspaceToFile()`.
  saveWorkspaceToFile: () => Promise<void>;
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
  // `opts.newWindow` (item 9) opens a fresh window (bound to the figure's
  // dataset) and focuses it FIRST, so the rest of the apply logic — already
  // scoped to "the focused window" via `setActive`/the singleton `set()`
  // calls — lands on the new window instead of overwriting whatever was
  // focused before.
  applyOriginFigure: (id: string, opts?: { newWindow?: boolean }) => void;
  // Facet-by-column (gap #21 residual): partitions `datasetId`'s analysis-view
  // rows into one small-multiples panel per distinct level of `col` (via
  // `lib/facet.facetPayloads`) and populates `facetPanels` for MultiPanelStage
  // to render. Activates `datasetId`, turns on `stackMode`, and clears any
  // prior `spatialPanels` arrangement (the two are mutually exclusive). No-op
  // (with a toast) when the dataset is missing or the column has no finite
  // levels to facet on.
  facetByColumn: (datasetId: string, col: number) => void;
  // Paneled x-breaks (gap #21 last residual): mirrors `facetByColumn`'s shape
  // but slices `datasetId`'s CURRENT x-column into contiguous segments (via
  // `lib/facet.breakPayloads`) instead of partitioning by a category column.
  // `breaks` is an explicit `[lo,hi]` override list; when omitted (or empty),
  // auto-detects via `lib/facet.suggestBreaks(xs, gapFactor)`. Activates
  // `datasetId`, turns on `stackMode`, and clears `spatialPanels`/
  // `facetPanels`. No-op (with a toast) when the dataset is missing, has no
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
  setFitSpec: (id: string, spec: { model: string } | null) => void;
  loadWorkspace: (ws: WorkspaceState) => void;
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
  // Smart folders (item 9): saved queries only — membership is derived.
  addSmartFolder: (name: string, query: string) => void;
  updateSmartFolder: (id: string, name: string, query: string) => void;
  removeSmartFolder: (id: string) => void;
  applyCorrections: (
    id: string,
    params: CorrectionParams,
    bg?: { datasetId: string; interp: string },
  ) => Promise<boolean>;
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
  setYScale: (yScale: AxisScale) => void;
  setXScale: (xScale: AxisScale) => void;
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
  // Secondary (right) Y axis: expose the already-rendered y2Scale/y2Lim fields
  // so the plot context menu can edit an Origin double-Y import's right axis.
  // Only meaningful when y2Keys is non-empty (otherwise there is no y2 scale).
  setY2Scale: (y2Scale: AxisScale | null) => void;
  setY2Lim: (y2Lim: [number, number] | null) => void;
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
  setGraphBuilderOpen: (open: boolean) => void;
  // Open the Graph Builder prefilled with a spec (the worksheet handoff,
  // MAIN_PLAN #4); clearGraphBuilderSeed drops the one-shot seed once read.
  openGraphBuilderSeeded: (spec: PlotSpec) => void;
  clearGraphBuilderSeed: () => void;
  // Send a box/violin Graph Builder spec to the stat stage: store the pickers +
  // switch statMode on; clearStatStageSeed drops the pending pickers once read.
  seedStatStage: (seed: StatStageSeed) => void;
  clearStatStageSeed: () => void;
  setWaterfallOpen: (open: boolean) => void;
  setReflViewOpen: (open: boolean) => void;
  setColumnSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setTextFormatHelpOpen: (open: boolean) => void;
  // Record a successful import in the recent list; clearRecent empties it.
  pushRecent: (name: string, size: number) => void;
  clearRecent: () => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
  setBaselineOverlay: (overlay: BaselineOverlay | null) => void;
  setPeakWizardEdit: (edit: PeakWizardEditBridge | null) => void;
  setBaselineAnchorEdit: (edit: AnchorEditBridge | null) => void;
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
  originBookClickOpens: OriginBookClickOpens;
}

const ORIGIN_BOOK_CLICK_OPENS = ["worksheet", "plot"];

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
  originBookClickOpens: "worksheet",
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
      originBookClickOpens: ORIGIN_BOOK_CLICK_OPENS.includes(p.originBookClickOpens as string)
        ? (p.originBookClickOpens as OriginBookClickOpens)
        : fb.originBookClickOpens,
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
    originBookClickOpens: s.originBookClickOpens,
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
  // The MDI window slice (state + actions) composes into this ONE store
  // instance (MAIN_PLAN #2) — selectors like useApp((s) => s.plotWindows)
  // are untouched by the split.
  ...createWindowsSlice(set, get),
  // Undo/redo (MAIN_PLAN #9) — see store/history.ts for the snapshot design.
  ...createHistorySlice(set),
  datasets: [],
  activeId: null,
  worksheetId: null,
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
  antialias: _initialPrefs.antialias,
  excludedDisplay: _initialPrefs.excludedDisplay,
  originBookClickOpens: _initialPrefs.originBookClickOpens,
  sigFigs: _initialPrefs.sigFigs,
  notation: _initialPrefs.notation,
  confirmRemove: _initialPrefs.confirmRemove,
  prefsOpen: false,
  yScale: "linear",
  xScale: "linear",
  showGrid: _initialPrefs.defaultGrid,
  showLegend: true,
  legendPos: "ne",
  plotTemplate: "screen",
  showAxisBox: false,
  stackMode: false,
  spatialPanels: null,
  facetPanels: null,
  breakPanels: null,
  insetMode: false,
  polarMode: false,
  statMode: false,
  xLim: null,
  yLim: null,
  xStep: null,
  yStep: null,
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  plotTitle: "",
  xAxisLabel: "",
  yAxisLabel: "",
  xKey: null,
  yKeys: null,
  y2Keys: null,
  y2Lim: null,
  y2Scale: null,
  y2Step: null,
  y2AxisLabel: "",
  refLines: [],
  annotations: [],
  regionShades: [],
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
  figurePageOpen: false,
  graphBuilderOpen: false,
  graphBuilderSeed: null,
  statStageSeed: null,
  waterfallOpen: false,
  reflViewOpen: false,
  columnSwitcherOpen: false,
  shortcutsOpen: false,
  textFormatHelpOpen: false,
  recent: loadRecent(),
  fitOverlay: null,
  peakOverlay: null,
  baselineOverlay: null,
  peakWizardEdit: null,
  baselineAnchorEdit: null,
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

  addDataset: (ds) => {
    // MAIN_PLAN #9: the single entry point for import/paste/demo/merge — one
    // call site covers all of them (mergeSelected/importFilesAppended/
    // pasteDataFromClipboard all route through here).
    get().recordHistory("add dataset");
    // Item 14 pin opt-out: an import is a passive rebind, same as a Library
    // click — a pinned focused window never absorbs it (shared helper;
    // `ds.name` seeds the title when a fresh window must be created, since
    // the dataset isn't in the store yet for createWindow to look up).
    retargetPassiveRebind(get(), ds.id, ds.name);
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
      selectedIds: [ds.id], // a fresh import is the sole selection
      // MULTI_PLOT_PLAN item 4: activeId IS the focused window's dataset
      // binding — keep plotWindows in sync so a later focus-away/back (or a
      // .dwk save) sees the newly-imported dataset, not whatever was bound
      // before this import.
      plotWindows: s.plotWindows.map((w) =>
        w.id === s.focusedWindowId ? { ...w, datasetId: ds.id } : w,
      ),
      stageTab: nextStageTab(ds, s.stageTab), // 2-D maps open in the Map view
      ...datasetViewDefaults(ds), // the shared rebind view reset (item 14 hoist)
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
          // Origin project: import every workbook as its own dataset. Per
          // ORIGIN_FILE_DECODE_PLAN #38, `book` is one of three shapes: the
          // PRIMARY book's no-data marker (its real time/values are at the
          // top-level `data` instead), another book's lazy preview (small
          // preview time/values now, full data fetched on first activation —
          // `pending` records how), or — only under the `full_books` escape
          // hatch, never requested here — a full inline DataStruct.
          const bookSource = data.book_source;
          for (const book of data.books) {
            const meta = (book.metadata ?? {}) as Record<string, unknown>;
            const short = String(meta.origin_book ?? "Book");
            const long = String(meta.origin_book_long ?? "");
            const label = long && long !== short ? `${short} — ${long}` : short;
            const id = nextDatasetId();
            if (isPrimaryBookMarker(book)) {
              get().addDataset({
                id,
                name: `${stem}:${label}`,
                data: {
                  time: data.time,
                  values: data.values,
                  labels: book.labels,
                  units: book.units,
                  metadata: book.metadata,
                },
              });
            } else if (isLazyBookEntry(book)) {
              get().addDataset({
                id,
                name: `${stem}:${label}`,
                data: {
                  time: book.preview.time,
                  values: book.preview.values,
                  labels: book.labels,
                  units: book.units,
                  metadata: book.metadata,
                },
                ...(bookSource
                  ? { pending: { ...bookSource, bookId: book.id, rows: book.rows, cols: book.cols } }
                  : {}),
              });
            } else {
              get().addDataset({ id, name: `${stem}:${label}`, data: book });
            }
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
          delete data.book_source;
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

  ensureBookData: (id) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds?.pending) return;
    installBookData(id, ds.pending).catch((e) => {
      toast(
        `couldn't load full data for "${ds.name}" — ${e instanceof Error ? e.message : "error"}`,
        "danger",
      );
    });
  },
  resolvePendingDatasets: async () => {
    const pending = get().datasets.filter((d) => d.pending);
    await Promise.all(pending.map((d) => installBookData(d.id, d.pending!)));
  },
  resolveDataset: async (id) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds?.pending) return ds;
    // Slow-path notice only — a toast on every activation would be noise
    // since the common cached-parse fetch resolves in ~20ms.
    const timer = setTimeout(() => {
      toast(`fetching full data for "${ds.name}"…`);
    }, 400);
    try {
      await installBookData(id, ds.pending);
    } finally {
      clearTimeout(timer);
    }
    return get().datasets.find((d) => d.id === id);
  },
  resolveDatasets: async (ids) => {
    const CONCURRENCY = 6;
    const results: (Dataset | undefined)[] = new Array(ids.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = cursor++;
        if (i >= ids.length) return;
        results[i] = await get().resolveDataset(ids[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    return results.filter((d): d is Dataset => d != null);
  },
  saveWorkspaceToFile: async () => {
    const all = get().datasets;
    if (all.length === 0) {
      get().setStatus("no datasets to save");
      return;
    }
    // A .dwk must be self-contained (#38): resolve every pending lazy book
    // FIRST — an exported file never references a book by a path/token that
    // may not exist on another machine or after a server restart.
    const pendingCount = all.filter((d) => d.pending).length;
    if (pendingCount > 0) {
      get().setStatus(`fetching ${pendingCount} book${pendingCount === 1 ? "" : "s"} before saving…`);
      try {
        await get().resolvePendingDatasets();
      } catch (e) {
        const msg = `save failed — couldn't load full data for every book: ${e instanceof Error ? e.message : "error"}`;
        get().setStatus(msg);
        toast(msg, "danger");
        return;
      }
    }
    saveBlob(
      new Blob([serializeWorkspace({ ...get(), plotWindows: get().windowsForSave() })], {
        type: "application/json",
      }),
      "workspace.dwk",
    );
    const msg = `saved workspace — ${all.length} dataset${all.length === 1 ? "" : "s"}`;
    get().setStatus(msg);
    toast(msg, "ok");
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
  applyOriginFigure: (id, opts) => {
    const entry = get().originFigures.find((f) => f.id === id);
    if (!entry?.datasetId) return;
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
          // Origin draws every layer with a full 4-side frame box; the
          // decoded figure carries no separate "border on/off" flag, so an
          // applied figure defaults to boxed (owner-routing item 4).
          showAxisBox: true,
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
          showAxisBox: true, // Origin layers are boxed by default (item 4)
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
        const { panels: placed, spatial } = spatialResult;
        get().setActive(entry.datasetId);
        // showAxisBox is the SINGLETON flag `useMultiPanelStage` reads for
        // every spatial panel (item 4) — Origin layers are boxed by default.
        set({
          stackMode: true,
          spatialPanels: placed,
          facetPanels: null,
          breakPanels: null,
          showAxisBox: true,
          // Region bands are single-plot overlays; a spatial multi-panel
          // apply clears any prior figure's bands (no per-panel shade
          // support yet — an honest, documented gap, not a guess).
          regionShades: [],
        });
        get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
        if (!spatial) {
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
      showAxisBox: true, // Origin layers are boxed by default (item 4)
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
      ...(originLegendPos(fig) ? { legendPos: originLegendPos(fig)! } : {}),
      ...(selection
        ? {
            xKey: selection.xKey,
            yKeys: selection.yKeys,
            seriesStyles: selection.styles,
            seriesLabels: selection.labels,
          }
        : {}),
    });
    get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
  },
  // Facet-by-column (gap #21 residual): see the state-field doc comment for
  // why `facetPanels` is a parallel field rather than a reuse of
  // `spatialPanels`. Reads the ANALYSIS view (guard #11 — exclusion #50 ∪
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
    set({ stackMode: true, spatialPanels: null, facetPanels: panels, breakPanels: null });
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
    set({ stackMode: true, spatialPanels: null, facetPanels: null, breakPanels: panels });
    get().recordMacro(`Break x-axis at gaps`, `qz.breakAtGaps(${lit(datasetId)})`);
  },
  // Replace the whole library with a restored workspace (from a .dwk file).
  // Resets every per-dataset view (channels, styles, axis limits) and drops the
  // overlays/markers tied to the old datasets — same hygiene as setActive.
  // Runs on BOTH triggers that call this action: the autosave restore on
  // startup, and an explicit File ▸ Open .dwk — so a legacy v1 doc's `group`
  // strings get promoted to folders (item 6) either way, exactly once.
  loadWorkspace: (ws) =>
    set((s) => {
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
      // Plot windows (item 7): restore a persisted layout when the doc has
      // one (validated at the untrusted-boundary via `sanitizePlotWindows` —
      // clamps dead dataset refs/geometry, never throws); otherwise (a v1-v6
      // doc with no `plotWindows`, or a genuinely fresh workspace) collapse
      // back to the ≥1-window invariant's single maximized window, bound to
      // the newly-restored active dataset, with a fresh view — unchanged
      // from before item 7.
      const win = mainWindow(active);
      const dsIds = new Set(datasets.map((d) => d.id));
      const restored = sanitizePlotWindows(ws.plotWindows, dsIds);
      // Items 11/17: the ≥1-window invariant is specifically ≥1 PLOT window —
      // non-plot kinds (snapshot / worksheet / map) can't hold focus, so a
      // doc whose surviving windows are all non-plot still gets the fresh
      // maximized main window appended; and the restored focus id must land
      // on a plot window (falling back to the first one), never elsewhere.
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
        expandedFolders: [...new Set([...(ws.expandedFolders ?? []), ...migrated.createdFolderIds])],
        activeId: active,
        // item 15: never round-trips (transient UI, like `stageTab`) — a
        // fresh load always falls back to `activeId`.
        worksheetId: null,
        selectedIds: selected.length ? selected : active ? [active] : [],
        originFigures: ws.originFigures ?? [], // restored from the .dwk (v2 persists them)
        smartFolders: ws.smartFolders ?? [], // saved queries (item 9) — .dwk persists them
        reports: ws.reports ?? [], // report sheets (#36) — .dwk v2 persists them
        openReportId: null,
        macroSteps: ws.macroSteps ?? [], // typed pipeline (#6) — .dwk v3
        recalcMode: ws.recalcMode ?? "auto", // recalc engine (#1) — .dwk v3
        figureDocs: ws.figureDocs ?? [], // figure documents (#12) — .dwk v3
        figureDocSeed: null,
        staleDatasets: [],
        staleFits: [],
        stageTab: activeDs ? nextStageTab(activeDs, s.stageTab) : s.stageTab,
        xKey: restoredView ? restoredView.xKey : null,
        yKeys: restoredView ? restoredView.yKeys : null,
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
        spatialPanels: null, // decode-plan #36 — never restored from a stale figure apply
        facetPanels: null, // gap #21 residual — likewise never restored from a stale facet
        breakPanels: null, // gap #21 residual — likewise never restored from a stale break
        fitOverlay: null,
        peakOverlay: null,
        baselineOverlay: null,
        peakWizardEdit: null,
        // NOT baselineAnchorEdit: the useBaseline hook owns it and re-pushes
        // (with a cleared anchor list) on dataset change — nulling it here
        // would fight that effect's cleanup ordering.
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
        plotWindows,
        focusedWindowId,
        // The rest of the PlotView cluster (item 7) — only touched when
        // restoring an actual persisted layout; the legacy/fresh path never
        // wrote these here before item 7, so they're left alone (whatever
        // the pre-load session had) exactly as before.
        ...(restoredView
          ? {
              yScale: restoredView.yScale,
              xScale: restoredView.xScale,
              showGrid: restoredView.showGrid,
              showLegend: restoredView.showLegend,
              legendPos: restoredView.legendPos,
              plotTemplate: restoredView.plotTemplate,
              showAxisBox: restoredView.showAxisBox,
              stackMode: restoredView.stackMode,
              insetMode: restoredView.insetMode,
              polarMode: restoredView.polarMode,
              statMode: restoredView.statMode,
              xFmt: restoredView.xFmt,
              yFmt: restoredView.yFmt,
              plotTitle: restoredView.plotTitle,
              xAxisLabel: restoredView.xAxisLabel,
              yAxisLabel: restoredView.yAxisLabel,
              refLines: restoredView.refLines,
              annotations: restoredView.annotations,
              regionShades: restoredView.regionShades,
              waterfall: restoredView.waterfall,
            }
          : {}),
        status: `loaded workspace — ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`,
      };
    }),
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
        stageTab: "worksheet",
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
  // Explicit-list selection (folder "Select all" — item 8): de-duplicated and
  // clamped to live datasets; the plotted/active dataset stays put.
  selectIds: (ids) =>
    set((s) => {
      const live = new Set(s.datasets.map((d) => d.id));
      return { selectedIds: [...new Set(ids)].filter((id) => live.has(id)) };
    }),
  removeDataset: (id) => {
    get().recordHistory("remove dataset");
    set((s) => {
      const datasets = s.datasets.filter((d) => d.id !== id);
      const activeId =
        s.activeId === id ? (datasets[0]?.id ?? null) : s.activeId;
      // item 15: drop a worksheet-only override pointing at the removed
      // dataset — else the Worksheet tab would strand on a dead id.
      const worksheetId = s.worksheetId === id ? null : s.worksheetId;
      const selectedIds = s.selectedIds.filter((x) => x !== id);
      const removed = new Set([id]);
      const originFigures = pruneOriginFigureRefs(s.originFigures, removed);
      const reports = pruneReportRefs(s.reports, removed);
      const figureDocs = s.figureDocs.map((f) =>
        f.datasetId && removed.has(f.datasetId) ? { ...f, datasetId: null } : f,
      );
      // A removed dataset nulls any window bound to it (MULTI_PLOT_PLAN
      // decision #4) — the window shows an empty "dataset removed" state,
      // never force-closed (same treatment as figureDocs above).
      const plotWindows = s.plotWindows.map((w) =>
        w.datasetId && removed.has(w.datasetId) ? { ...w, datasetId: null } : w,
      );
      return { datasets, activeId, worksheetId, selectedIds, originFigures, reports, figureDocs, plotWindows };
    });
  },
  // Delete key: remove every selected dataset (falling back to the active one if
  // nothing is multi-selected); reselect the first survivor so the plot recovers.
  removeSelected: () => {
    get().recordHistory("remove selected datasets");
    set((s) => {
      const ids = new Set(
        s.selectedIds.length ? s.selectedIds : s.activeId ? [s.activeId] : [],
      );
      if (ids.size === 0) return {};
      const datasets = s.datasets.filter((d) => !ids.has(d.id));
      const activeId =
        s.activeId && !ids.has(s.activeId) ? s.activeId : (datasets[0]?.id ?? null);
      const worksheetId = s.worksheetId && ids.has(s.worksheetId) ? null : s.worksheetId;
      const originFigures = pruneOriginFigureRefs(s.originFigures, ids);
      const reports = pruneReportRefs(s.reports, ids);
      const figureDocs = s.figureDocs.map((f) =>
        f.datasetId && ids.has(f.datasetId) ? { ...f, datasetId: null } : f,
      );
      const plotWindows = s.plotWindows.map((w) =>
        w.datasetId && ids.has(w.datasetId) ? { ...w, datasetId: null } : w,
      );
      return {
        datasets,
        activeId,
        worksheetId,
        selectedIds: activeId ? [activeId] : [],
        originFigures,
        reports,
        figureDocs,
        plotWindows,
      };
    });
  },
  // Bulk-remove by explicit id list (item 17's "manage books" dialog) — unlike
  // removeSelected, this doesn't touch/depend on the transient row selection.
  removeDatasets: (ids) => {
    get().recordHistory("remove datasets");
    set((s) => {
      if (ids.length === 0) return {};
      const drop = new Set(ids);
      const datasets = s.datasets.filter((d) => !drop.has(d.id));
      const activeId =
        s.activeId && !drop.has(s.activeId) ? s.activeId : (datasets[0]?.id ?? null);
      const worksheetId = s.worksheetId && drop.has(s.worksheetId) ? null : s.worksheetId;
      const selectedIds = s.selectedIds.filter((x) => !drop.has(x));
      const originFigures = pruneOriginFigureRefs(s.originFigures, drop);
      const reports = pruneReportRefs(s.reports, drop);
      const figureDocs = s.figureDocs.map((f) =>
        f.datasetId && drop.has(f.datasetId) ? { ...f, datasetId: null } : f,
      );
      const plotWindows = s.plotWindows.map((w) =>
        w.datasetId && drop.has(w.datasetId) ? { ...w, datasetId: null } : w,
      );
      return { datasets, activeId, worksheetId, selectedIds, originFigures, reports, figureDocs, plotWindows };
    });
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
      reports: [],
      figureDocs: [],
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
        stageTab: nextStageTab(clone, s.stageTab),
        xKey: null,
        yKeys: null,
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
        spatialPanels: null, // decode-plan #36 — the clone becomes active, not a figure
        facetPanels: null, // gap #21 residual — likewise, not a facet arrangement
        breakPanels: null, // gap #21 residual — likewise, not a break arrangement
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
  setCellValue: (id, row, col, value) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    if (col >= baseCount) return; // computed column — read-only
    get().recordHistory("cell edit");
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
    get().recordHistory("add column");
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
    get().recordHistory("remove column");
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
  setDatasetNotes: (id, notes) => {
    get().recordHistory("edit notes");
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, notes: notes.trim() ? notes : undefined } : d,
      ),
    }));
  },
  // Add a trimmed, de-duplicated tag to a dataset (blank or duplicate = no-op).
  addDatasetTag: (id, tag) => {
    get().recordHistory("add tag");
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
    });
  },
  // Remove a tag; the list drops to undefined when it empties (keeps .dwk clean).
  removeDatasetTag: (id, tag) => {
    get().recordHistory("remove tag");
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.tags) return d;
        const tags = d.tags.filter((x) => x !== tag);
        return { ...d, tags: tags.length ? tags : undefined };
      }),
    }));
  },
  // Assign a dataset to a (trimmed) group; blank clears it back to Ungrouped.
  setDatasetGroup: (id, group) => {
    get().recordHistory("set group");
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, group: group.trim() ? group.trim() : undefined } : d,
      ),
    }));
  },

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

  // ── Smart folders (project-organization plan item 9) ────────────────────
  // Saved queries, nothing else — members are derived per render by
  // lib/smartfolders, so there is no membership state to keep in sync.
  addSmartFolder: (name, query) =>
    set((s) => {
      const nm = name.trim();
      if (!nm) return {};
      return {
        smartFolders: [
          ...s.smartFolders,
          { id: `smf-${Date.now().toString(36)}-${++_idSeq}`, name: nm, query: query.trim() },
        ],
      };
    }),
  updateSmartFolder: (id, name, query) =>
    set((s) => ({
      smartFolders: s.smartFolders.map((f) =>
        f.id === id ? { ...f, name: name.trim() || f.name, query: query.trim() } : f,
      ),
    })),
  removeSmartFolder: (id) =>
    set((s) => ({ smartFolders: s.smartFolders.filter((f) => f.id !== id) })),

  // Corrections always apply to the pristine `raw`, never to an already-
  // corrected `data` (the MATLAB pipeline is replace, not accumulate). The
  // first import becomes `raw`; re-applying with new params re-derives `data`.
  // An optional `bg` picks another loaded dataset as the reference background
  // (step 4 of the pipeline): we forward its CURRENT `data` + the interp method
  // so the golden /api/corrections/apply does the interpolated subtraction.
  applyCorrections: async (id, params, bg) => {
    try {
      // #38 deferred edge: corrections must never compute on a still-pending
      // (preview-only) dataset — resolve the target AND any bg reference to
      // full data first. A resolve failure lands in the catch below, reusing
      // the existing "corrections failed" status/toast rather than silently
      // falling through to the preview.
      const ds = await get().resolveDataset(id);
      if (!ds) return false;
      const raw = ds.raw ?? ds.data;
      // Resolve the background only if it points at a real, different dataset.
      const bgDs =
        bg && bg.datasetId !== id ? await get().resolveDataset(bg.datasetId) : undefined;
      const bgRef = bgDs ? { datasetId: bgDs.id, interp: bg!.interp } : undefined;
      const req: CorrectionsRequest = { dataset: raw, params };
      if (bgDs) {
        req.bg_dataset = bgDs.data;
        req.bg_interp = bg!.interp;
      }
      const corrected = await applyCorrectionsApi(req);
      // excludedRows are raw row INDICES into ds.data; an xTrim shrinks/shifts
      // the rows (corrections.py step 1), so carrying stale indices forward would
      // exclude the WRONG rows (or silently lose the exclusion). Drop them when
      // the row count changes rather than corrupt the analysis view.
      const rowsChanged = corrected.time.length !== ds.data.time.length;
      // Recompute any computed columns from the freshly-corrected base.
      get().recordHistory("apply corrections");
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
      return true;
    } catch (e) {
      get().setStatus(
        `corrections failed: ${e instanceof Error ? e.message : "error"}`,
      );
      return false; // callers can see failure (review 2026-07-11)
    }
  },
  resetCorrections: (id) => {
    const ds = get().datasets.find((d) => d.id === id);
    get().recordHistory("reset corrections");
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
      const transferable = { ...src.corrections }; // anchors are hand-traced on the SOURCE curve - not transferable
      delete transferable.bgAnchors;
      delete transferable.bgAnchorMethod;
      await get().applyCorrections(id, transferable, useBg);
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
  setYScale: (yScale) => {
    set({ yScale });
    get().recordMacro(`Y axis ${yScale}`, `qz.setYScale(${lit(yScale)})`);
  },
  setXScale: (xScale) => {
    set({ xScale });
    get().recordMacro(`X axis ${xScale}`, `qz.setXScale(${lit(xScale)})`);
  },
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowLegend: (showLegend) => set({ showLegend }),
  setLegendPos: (legendPos) => set({ legendPos }),
  setPlotTemplate: (plotTemplate) => set({ plotTemplate }),
  setShowAxisBox: (showAxisBox) => set({ showAxisBox }),
  // A manual toggle (on OR off) always drops any spatial arrangement from a
  // prior Origin multi-panel apply, or a prior facet-by-column arrangement
  // (gap #21 residual) — the plain per-channel split (or leaving stack mode)
  // is what the user asked for, never a stale spatial/facet grid.
  setStackMode: (stackMode) =>
    set({ stackMode, spatialPanels: null, facetPanels: null, breakPanels: null }),
  setInsetMode: (insetMode) => set({ insetMode }),
  setPolarMode: (polarMode) => set({ polarMode }),
  setStatMode: (statMode) => set({ statMode }),
  // Clears the paired decoded step too: a manual/Inspector range (or the
  // smart auto-scale reset to null) is no longer the Origin figure that
  // produced xStep/yStep, so a stale step must never leak onto it.
  setXLim: (xLim) => set({ xLim, xStep: null }),
  setYLim: (yLim) => set({ yLim, yStep: null }),
  // A manual y2 range is no longer the Origin figure that decoded y2Step, so
  // drop the stale step alongside it (mirrors setYLim / yStep above).
  setY2Scale: (y2Scale) => set({ y2Scale }),
  setY2Lim: (y2Lim) => set({ y2Lim, y2Step: null }),
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
    set({ y2Keys, ...(y2Keys ? {} : { y2Lim: null, y2Scale: null, y2Step: null, y2AxisLabel: "" }) });
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
  // Set (or clear, t=null) a modeling-type OVERRIDE on the ACTIVE dataset.
  // Mirrors setChannelRole: overrides live on the dataset (persist across
  // switches + round-trip .dwk); absent = auto-inference (lib/modeling).
  setChannelType: (channel, t) => {
    const id = get().activeId;
    if (id == null) return;
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
  excludeSelectedRows: () => {
    const id = get().activeId;
    const sel = get().selection;
    if (id == null || sel?.datasetId !== id || !sel.rows.length) return;
    get().recordHistory("row exclusion");
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
    get().recordHistory("row exclusion");
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
  // Item 9's figure-doc half: a live doc only (a frozen doc's snapshot isn't
  // a live `Dataset` a window can bind to — that gap is Tier 3 item 11's
  // "snapshot-as-window"). Creates + focuses a new window bound to the doc's
  // dataset, then applies the config's channel/scale/label fields — NOT its
  // `seriesStyles` (a `FigureConfig` carries the EXPORT style shape,
  // `ExportSeriesStyle[]`, which has no inverse back to the live
  // `Record<number,SeriesStyle>`; the window opens with default series
  // styling, same as any other fresh window).
  openFigureDocInWindow: (id) => {
    const doc = get().figureDocs.find((f) => f.id === id);
    if (!doc || !doc.live || !doc.datasetId) return;
    const s = get();
    const title = dedupeWindowTitle(
      doc.name,
      s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
    );
    const winId = s.createWindow(doc.datasetId, undefined, title);
    s.focusWindow(winId);
    const c = doc.config;
    const targetDs = s.datasets.find((d) => d.id === doc.datasetId);
    set({
      // Plot-intent (item 1): "open in new window" always means look at the
      // plot, so surface it regardless of which tab was showing.
      ...(targetDs ? { stageTab: plotIntentStageTab(targetDs) } : {}),
      xKey: c.xKey,
      yKeys: c.yKeys,
      xScale: c.xScale,
      yScale: c.yScale,
      plotTitle: c.title,
      xAxisLabel: c.xLabel,
      yAxisLabel: c.yLabel,
    });
    get().recordMacro(`Open figure "${doc.name}" in new window`, `qz.openFigureDocInWindow(${lit(id)})`);
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
  setFigurePageOpen: (figurePageOpen) => set({ figurePageOpen }),
  setGraphBuilderOpen: (graphBuilderOpen) => set({ graphBuilderOpen }),
  openGraphBuilderSeeded: (graphBuilderSeed) => set({ graphBuilderSeed, graphBuilderOpen: true }),
  clearGraphBuilderSeed: () => set({ graphBuilderSeed: null }),
  seedStatStage: (statStageSeed) => set({ statStageSeed, statMode: true }),
  clearStatStageSeed: () => set({ statStageSeed: null }),
  setWaterfallOpen: (waterfallOpen) => set({ waterfallOpen }),
  setReflViewOpen: (reflViewOpen) => set({ reflViewOpen }),
  setColumnSwitcherOpen: (columnSwitcherOpen) => set({ columnSwitcherOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setTextFormatHelpOpen: (textFormatHelpOpen) => set({ textFormatHelpOpen }),
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
  setPeakWizardEdit: (peakWizardEdit) => set({ peakWizardEdit }),
  setBaselineAnchorEdit: (baselineAnchorEdit) => set({ baselineAnchorEdit }),
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
