// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.
import { create } from "zustand";
import { uploadFile } from "../lib/api";
import type { Notation } from "../lib/format";
import { recomputeWithErrors } from "../lib/formula";
import { asAlreadyComputed } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import type { WorkbookNode } from "../lib/workbooks";
import { snapshotView, type PlotView } from "../lib/plotview";
import { nextStageTab, type StageTab } from "../lib/stagetab";
// The MDI window-management slice (MAIN_PLAN #2): state + actions live in
// ./windows and are composed into THIS store instance below; the shared
// rebind helpers are imported back for addDataset (setActive's live in
// ./datasetSelection).
import { createWindowsSlice, datasetViewDefaults, retargetPassiveRebind, type WindowsSlice } from "./windows";
import { rebindFocusedPlotWindow } from "./windowDocuments";
// Composed store slices (each documented in its own file) + workspace IO:
import { createHistorySlice, type HistoryBatchToken, type HistorySlice } from "./history";
import { createWorksheetSelectionSlice, type WorksheetSelectionSlice } from "./worksheetSelection";
import { runSaveWorkspace, runSaveWorkspaceToFile } from "./workspaceIOLazy";
import { createReductionsSlice, type ReductionsSlice } from "./reductions";
import { createReimportSlice, type ReimportSlice } from "./reimportLazy";
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
import { createGadgetSlice, type GadgetSlice } from "./gadget";
import { createDatasetMetaSlice, type DatasetMetaSlice } from "./datasetMeta";
import { createDataIntakeSlice, type DataIntakeSlice } from "./dataIntake";
import { createRowStateSlice, type RowStateSlice } from "./rowState";
import { createImportSlice, type ImportSlice } from "./importDatasetsLazy";
import { createWorkbookActionsSlice, type WorkbookActionsSlice } from "./workbookActions";
import { createWorkbookCombineSlice, type WorkbookCombineSlice } from "./workbookCombine";
import { createWorkbookSeparateSlice, type WorkbookSeparateSlice } from "./workbookSeparate";
import { createWorkbookTransferSlice, type WorkbookTransferSlice } from "./workbookTransfer";
import { recomputeStaleFits } from "./recalcFits";
import { recomputeStaleDatasets } from "./recalcDatasets";
import { createRecentsSlice, type RecentsSlice } from "./recents";
import { createProjectSlice, type ProjectSlice } from "./project";
import { createTrashSlice, type TrashSlice } from "./trash";
import { createComputedColumnsSlice, refreshFitRefsLater, type ComputedColumnsSlice } from "./computedColumns";
import { createDerivedWorksheetsSlice, type DerivedWorksheetsSlice } from "./derivedWorksheets";
import { createCorrectionsSlice, type CorrectionsSlice } from "./corrections";
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
import type { Composition } from "../lib/composition";
import type { ReportEntry } from "../lib/report";
import type { PanelFit } from "../lib/panelLayout";
import type { PageSetup } from "../lib/pagesetup";
import type { FwhmResult } from "../lib/peakwidth";
import type { IntegralResult } from "../lib/plotRangeSelection";
import type { FigureDoc } from "../lib/figuredoc";
import { downstreamOf, markStale, type RecalcMode } from "../lib/recalc";
import { nextDatasetId } from "./idSeq";
import { createReportsFigureDocsSlice, type ReportsFigureDocsSlice } from "./reportsFigureDocs";
import { createViewAppliersSlice, type ViewAppliersSlice } from "./viewAppliers";
import { createWorkspaceHydrationSlice, type WorkspaceHydrationSlice } from "./workspaceHydration";
import { createMacroPipelineSlice, type MacroPipelineSlice } from "./macroPipeline";
import { createWorkshopFlagsSlice, type WorkshopFlagsSlice } from "./workshopFlags";
import { createDatasetListEditsSlice, type DatasetListEditsSlice } from "./datasetListEdits";
import { createDatasetSelectionSlice, type DatasetSelectionSlice } from "./datasetSelection";
import { toast } from "./toasts";
import { loadPrefs, syncPrefs, type Prefs } from "./prefs";
import { createOriginImportSlice, type OriginImportSlice } from "./originImport";
import { createRecipeFidelitySlice, type RecipeFidelitySlice } from "./recipeFidelity";
import { createOriginFallbackSlice, type OriginFallbackSlice } from "./originFallbackLazy";
import { createPlotViewSettingsSlice, type PlotViewSettingsSlice } from "./plotViewSettings";
import type {
  Annotation,
  AxisFormat, AxisScale,
  ChannelRole,
  Dataset,
  DataStruct, DefaultTrace,
  FitSpec,
  ModelingType,
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
 *  sites. `asAlreadyComputed` (SILENT_STATE_CORRUPTION_PLAN #2) is sound
 *  HERE ONLY because `d.data` is a Dataset's OWN table — by construction it
 *  already carries `d.formulas`' stale columns. A caller with base-only data
 *  must NOT route through `recompute` — see derivedWorksheets.ts's
 *  `recomputeFromBase` (the #4 fix). */
export const recompute = (d: Dataset): Dataset => {
  if (!d.formulas?.length) return d;
  const { data, errors } = recomputeWithErrors(asAlreadyComputed(d.data), d.formulas);
  return { ...d, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
};
// The shared `<prefix>-<t36>-<n>` object-id sequence moved to store/idSeq.ts
// (P4.1): a module-level `let` cannot be incremented across a module boundary,
// and store/reportsFigureDocs.ts mints `rep-`/`figd-` ids from it. Re-exported
// so every existing `import { nextDatasetId } from "./useApp"` still resolves
// (split.ts, importDatasets.ts, gadget.ts, workspaceIO.ts, ...).
export { nextDatasetId, nextFolderId } from "./idSeq";
// (window ids: see store/windows.ts — the MDI slice owns its own sequence)

// (single-flight lazy-book resolution — ORIGIN_FILE_DECODE_PLAN #38 —
// extracted to lib/bookData.ts under this module's size ratchet; the four
// resolve*/ensureBookData actions that call it, plus pasteDataFromClipboard,
// now live in store/dataIntake.ts — DataIntakeSlice, composed below.)

// (mainWindow / focusTransientReset moved to store/windows.ts with the window
// slice, then on to store/workspaceHydration.ts's loadWorkspace (P4.1's
// fourth domain) — that module imports them directly now.
// datasetViewDefaults / retargetPassiveRebind stay imported above for
// addDataset; setActive's focusedRebindPatch moved with it.)

// Recalc scheduler internals (#1): a module-level debounce timer plus an
// in-progress guard so the recalc's own applyCorrections calls never re-mark
// or re-schedule (the loop would otherwise feed itself).
let _recalcTimer: ReturnType<typeof setTimeout> | null = null;
let _recalcInProgress = false;
let _recalcPending = false; // #3: request mid-pass -> follow-up pass, not a no-op

// (the quick-fit debounce timer moved to store/gadget.ts with the slice.)

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
/** Committed integral region from the ∫ tool (lib/plotRangeSelection). */
export type { IntegralResult };

// ReflectivitySeed/StatStageSeed/PeakWizardEditBridge/AnchorEditBridge moved
// with their fields to store/workshopFlags.ts; re-exported so no importer changed.
export type { AnchorEditBridge, PeakWizardEditBridge, ReflectivitySeed, StatStageSeed } from "./workshopFlags";

export type LegendPos = "ne" | "nw" | "se" | "sw";
// Keys the Preferences dialog can set through the generic setPref action.
// DERIVED from `Prefs` rather than restated: the hand-maintained union had
// to be edited in lockstep with prefs.ts for every new preference, which is
// drift waiting to happen (and 18 lines of it). `keyof` cannot go stale.
export type PrefKey = keyof Prefs;

// Exported for the window slice (store/windows.ts), which types its actions
// against the WHOLE composed store — cross-slice reads/writes are the point
// of slice composition (type-only in that direction, so no runtime cycle).
export interface AppState extends WindowsSlice, HistorySlice, ReductionsSlice, ReimportSlice, ReimportAllSlice, PanelsSlice, PointerToolSlice, SplitSlice, ShapesSlice, RegionShadesSlice, ToolWindowsSlice, OriginImportSlice, OriginFallbackSlice, WorksheetSelectionSlice, LibraryPanelSlice, GraphBuilderSlice, CorrectionsSlice, ComputedColumnsSlice, DerivedWorksheetsSlice, CellEditSlice, GadgetSlice, DatasetMetaSlice, DataIntakeSlice, RowStateSlice, TrashSlice, ImportSlice, RecentsSlice, ProjectSlice, FigureLifecycleSlice, QuickPlotActionSlice, QuickFigureCreateSlice, QuickPlotTemplatesSlice, PlotRecipesSlice, QuickFigureBuilderSlice, PageDocumentSlice, RoisSlice, RoiCutsPanelSlice, WorkbookActionsSlice, CollectionsSlice, WorkbookCombineSlice, WorkbookSeparateSlice, LibraryDetailsColumnsSlice, WorkbookTransferSlice, RecipeFidelitySlice, PlotViewSettingsSlice, ReportsFigureDocsSlice, ViewAppliersSlice, WorkspaceHydrationSlice, MacroPipelineSlice, WorkshopFlagsSlice, DatasetListEditsSlice, DatasetSelectionSlice {
  datasets: Dataset[];
  // activeId / selectedIds / worksheetId: declared on DatasetSelectionSlice
  // (store/datasetSelection.ts) with the actions that move them.
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
  // folders / expandedFolders / smartFolders: declared on DatasetListEditsSlice
  // (store/datasetListEdits.ts) with the actions that edit them.
  // Library workbooks (LIBRARY_WORKBOOK_UX_PLAN L0.1's folder -> workbook ->
  // worksheet/figure/analysis/note hierarchy, PR A2). Membership rides on
  // `Dataset.workbookId`, same design as `folders`/`folderId` above; this
  // array is populated ONLY by loadWorkspace (from `ws.workbooks ?? []` —
  // see that action's doc for why the explicit fallback matters) until PR
  // A3/A4 add mutating actions.
  workbooks: WorkbookNode[];
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  stageTab: StageTab;
  theme: Theme;
  accent: Accent;
  density: Density;
  palette: string; // series colour-cycle preset (overrides --series-1..8)
  // P3.3: the non-colour half of that cycle — auto dash/marker by series
  // position, opt-in. Full rationale on `Prefs.autoSeriesStyles` (prefs.ts).
  autoSeriesStyles: boolean;
  // Behavioural prefs (Preferences dialog). reduceMotion + sigFigs/notation apply
  // live; defaultGrid seeds showGrid at startup; the rest persist for later use.
  reduceMotion: boolean;
  wheelZoom: boolean;
  defaultTrace: DefaultTrace;
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
  yScale: AxisScale; // Y axis scale (MAIN #12: linear/log/reciprocal)
  xScale: AxisScale; // X axis scale
  showGrid: boolean; // draw the plot grid lines
  showLegend: boolean; // show the floating legend overlay
  legendPos: LegendPos; // which corner the floating legend pins to
  legendStatic: boolean; // clean read-only legend (Origin apply, decode #52)
  legendTitle: string | null; // legend header text (Origin apply, decode #52)
  plotTemplate: string; // on-screen publication template (base font + line width)
  showAxisBox: boolean; // full frame on all four sides of the plot area (on by default)
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
  // EPHEMERAL — never persisted directly; a `.dwk` restore/focus switch
  // nulls it. For FACET specifically (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4)
  // this is no longer a durability gap: `facetKey` below is the durable
  // binding (bindings-owned, survives save/reopen/recipe-apply exactly like
  // `groupKey`), and `MultiPanelStage.tsx` rebuilds this field on demand from
  // it (`lib/facet.facetCompositionFromBinding`) whenever it's null — see
  // that component's own doc. Spatial/break stay genuinely ephemeral (no
  // binding to rebuild from). Each kind's panel shape, why the three differ,
  // and the reference-stable accessors: `lib/composition.ts`.
  composition: Composition | null;
  insetMode: boolean; // show a magnifier inset over the plot
  polarMode: boolean; // render the active series in polar (angle vs radius)
  statMode: boolean; statHideEmptyLevels: boolean; statShowGroupN: boolean; statShowSummary: boolean; statMarks: PlotView["statMarks"]; // Statistics stage (gap #16) + its P2.6 options
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
  // F4.4: the durable facet-by-column binding (bindings-owned like groupKey
  // — see `composition`'s doc above). `facetByColumn` sets it; a genuine
  // dataset switch resets it (`store/windowDefaults.ts`'s
  // `datasetViewDefaults`, same treatment as groupKey).
  facetKey: number | null;
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
  // On-plot analysis results (∫ / ∩ tools). Persist drawn until cleared via the
  // result chip or a dataset change (reset alongside the per-dataset view state).
  integral: IntegralResult | null;
  fwhmResult: FwhmResult | null;
  // (qfitRoi/qfitModel/.../gadgetCursorResult — the quick-fit / ROI-gadget
  // family's state — moved to store/gadget.ts's GadgetSlice.)
  // (prefsOpen + every workshop/dialog open flag, the reflectivity/stat-stage
  // seeds, the fit/peak/baseline overlays, the peak/anchor edit bridges and
  // the map/contour settings live on WorkshopFlagsSlice — store/workshopFlags.ts.)
  // rsmPeaks/setRsmPeaks: see RoisSlice (store/rois.ts) — relocated there
  // under the store-size ratchet (RSM_CUTS_PLAN item 4).
  // macroRecording / macroSteps / pipelineRunning — the macro recorder +
  // pipeline view's (#6) OWN state — declared on MacroPipelineSlice
  // (store/macroPipeline.ts); see AppState's extends list.
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
  // Recalc engine (#1): mark everything downstream of a data change, run the
  // dirty set now, and record/clear a dataset's re-runnable fit spec.
  setRecalcMode: (mode: RecalcMode) => void;
  touchDataset: (id: string) => void;
  recalcNow: () => Promise<void>;
  setFitSpec: (id: string, spec: FitSpec | null) => void;
  // loadWorkspace / appendWorkspace: see store/workspaceHydration.ts
  // (WorkspaceHydrationSlice) — composed exactly like plotViewSettings.ts,
  // reportsFigureDocs.ts and viewAppliers.ts.
  // setActive / activateFromLibrary / toggleSelected / selectRange /
  // selectIds: see store/datasetSelection.ts (DatasetSelectionSlice).
  // removeDataset … renameDataset, the folder-tree and smart-folder actions:
  // see store/datasetListEdits.ts (DatasetListEditsSlice).
  // addFormula/removeFormula/updateFormula live on ComputedColumnsSlice
  // (store/computedColumns.ts) — see AppState's extends list.
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
  // (setYScale … setErrKey and setSeriesOrder/toggleHidden/soloChannel/
  //  setWaterfall — every writer of singleton PlotView state — are declared
  //  on PlotViewSettingsSlice; see store/plotViewSettings.ts.)
  setChannelRole: (channel: number, role: ChannelRole | null) => void;
  setChannelType: (id: string, channel: number, t: ModelingType | null) => void;
  // (Row exclusion (#50), the row `selection` that feeds it, and the per-column
  // data filter (#53) are declared on RowStateSlice — store/rowState.ts, which
  // also carries their BUG-009 pending guards.)
  // (createWindow … windowsForSave — the window-management actions — are
  // declared on WindowsSlice; see store/windows.ts.)
  setPlotTool: (tool: PlotTool) => void;
  setIntegral: (integral: IntegralResult | null) => void;
  setFwhmResult: (result: FwhmResult | null) => void;
  // (the quick-fit / ROI-gadget family's state + actions moved to
  // store/gadget.ts — composed via createGadgetSlice at the top of this
  // literal, GadgetSlice added to this interface's extends clause.)
  // (setPrefsOpen, setCmdk … setContourScale — the workshop-flag, seed,
  // overlay and map/contour setters — are declared on WorkshopFlagsSlice.)
  // (startMacro … setPipelineRunning — the macro recorder + pipeline view's
  // actions — are declared on MacroPipelineSlice; see store/macroPipeline.ts.)
  setStatus: (status: string) => void;
}

// Appearance/behaviour prefs persistence (the `qz.prefs` blob) lives in
// store/prefs.ts (store-size ratchet, #54) — `loadPrefs`/`syncPrefs` imported
// above; `defaultPanelFit` (#54) rides the same mechanism as `defaultGrid`.
const _initialPrefs = loadPrefs();


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
  ...createRecipeFidelitySlice(),
  ...createOriginFallbackSlice(set, get),
  ...createLibraryPanelSlice(set, _initialPrefs.libraryPanelWidth),
  ...createGraphBuilderSlice(set, get),
  ...createCorrectionsSlice(set, get),
  ...createComputedColumnsSlice(set, get),
  ...createDerivedWorksheetsSlice(set, get),
  ...createCellEditSlice(set, get),
  ...createGadgetSlice(set, get),
  ...createDatasetMetaSlice(set, get),
  ...createDataIntakeSlice(set, get),
  ...createRowStateSlice(set, get),
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
  ...createPlotViewSettingsSlice(set, get),
  ...createReportsFigureDocsSlice(set, get),
  ...createViewAppliersSlice(set, get),
  ...createWorkspaceHydrationSlice(set, get),
  ...createMacroPipelineSlice(set),
  ...createWorkshopFlagsSlice(set),
  ...createDatasetListEditsSlice(set, get),
  ...createDatasetSelectionSlice(set, get),
  datasets: [],
  reports: [],
  openReportId: null,
  figureDocs: [],
  figureDocSeed: null,
  recalcMode: "auto",
  staleDatasets: [],
  staleFits: [],
  workbooks: [],
  leftCollapsed: false,
  rightCollapsed: false,
  stageTab: "plot",
  // Every `Prefs` key IS an AppState field of the same name — that is how
  // `prefsOf(s)` reads them straight back out — so the persisted blob seeds
  // them in ONE spread instead of a hand-maintained line per preference that
  // every new pref had to remember to add (the same anti-drift move
  // `PrefKey = keyof Prefs` made for the key union; #35's note above records
  // the 18 lines that union cost before it was derived). `libraryPanelWidth`
  // is re-assigned here with the IDENTICAL value `createLibraryPanelSlice`
  // above was already constructed from, so the order of the two is immaterial.
  ..._initialPrefs,
  yScale: "linear",
  xScale: "linear",
  showGrid: _initialPrefs.defaultGrid,
  showLegend: true,
  legendPos: "ne",
  legendStatic: false,
  legendTitle: null,
  plotTemplate: "screen",
  showAxisBox: true,
  stackMode: false,
  panelFit: "frames",
  pageSetup: null,
  composition: null,
  insetMode: false,
  polarMode: false,
  statMode: false, statHideEmptyLevels: false, statShowGroupN: true, statShowSummary: false, statMarks: {},
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
  facetKey: null,
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
  integral: null,
  fwhmResult: null,
  // (qfitRoi/.../gadgetCursorResult initial state now lives in
  // store/gadget.ts's createGadgetSlice, spread in below.)
  // (prefsOpen, cmdkOpen … contourScale initialized by
  // createWorkshopFlagsSlice above, spread into this literal.)
  // (macroRecording / macroSteps / pipelineRunning initialized by
  // createMacroPipelineSlice above, spread into this literal.)
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
        // lazy (bundle ratchet); reviews unit/label mismatches first (P2.5) —
        // declining lands the files as separate datasets below.
        const merged = await (await import("../lib/transformRun")).reviewedAppend(
          uploaded.map((u) => u.data),
          uploaded.map((u) => u.name),
        );
        if (!merged) throw new Error("append cancelled at the unit/name review");
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
    // Degrade to N separate datasets rather than a dead import (bypassGuard: "import-append" already holds it).
    toast(`${failReason} — importing separately instead`, failReason.startsWith("append cancelled") ? "info" : "danger");
    await get().importFiles(files, { bypassGuard: true });
  },

  // Body lives in ./workspaceIO, fetched on the first save by
  // ./workspaceIOLazy (bundle headroom slice 9 — see that file's doc).
  saveWorkspaceToFile: () => runSaveWorkspaceToFile(get),
  saveWorkspace: () => runSaveWorkspace(get),
  // (setActive … selectIds moved to createDatasetSelectionSlice; removeDataset
  // … renameDataset and the folder/smart-folder bodies to
  // createDatasetListEditsSlice — both spread into this literal above.)
  // Edit a single worksheet cell in place (col < 0 = the x/time column). Rebuilds
  // the dataset's arrays immutably (DataStruct stays frozen-by-contract) so the
  // plot + stats recompute live. Computed columns (the last `formulas.length`)
  // are read-only — a recompute would overwrite them — so an edit there is a
  // no-op. Editing a base cell recomputes the computed columns. Recovery of the
  // original is via Duplicate.
  // addFormula/removeFormula/updateFormula live on ComputedColumnsSlice
  // (store/computedColumns.ts) — see AppState's extends list.
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
  // (the PlotView-settings action implementations moved to
  // store/plotViewSettings.ts — composed via createPlotViewSettingsSlice
  // at the top of this literal.)
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
  // (the window-management action implementations moved to store/windows.ts —
  // composed via createWindowsSlice at the top of this literal.)
  setPlotTool: (plotTool) => set({ plotTool }),
  // Stamped with the dataset + X column it was drawn on (plotRangeSelection).
  setIntegral: (integral) =>
    set((s) => ({ integral: integral && { ...integral, context: { datasetId: s.activeId, xKey: s.xKey } } })),
  setFwhmResult: (fwhmResult) => set({ fwhmResult }),
  // (setPrefsOpen, setCmdk … setContourScale bodies moved to
  // createWorkshopFlagsSlice, spread into this literal above.)
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
    // #3: a request that arrives mid-pass (refreshFitRefsFor's own call,
    // reached from inside recomputeStaleFits below) sets the pending flag
    // for a follow-up pass below, rather than the silent no-op it used to be.
    if (_recalcInProgress) return void (_recalcPending = true);
    _recalcInProgress = true;
    try {
      await recomputeStaleDatasets(set, get);
      await recomputeStaleFits(set, get);
    } finally {
      _recalcInProgress = false;
      if (_recalcPending) void ((_recalcPending = false), get().recalcNow());
    }
  },
  setFitSpec: (id, spec) => {
    set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? { ...d, fitSpec: spec ?? undefined } : d)) }));
    refreshFitRefsLater(id, get); // P2.5: fit() columns follow the fit
  },
  // (startMacro … setPipelineRunning bodies moved to
  // createMacroPipelineSlice, spread into this literal above.)
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
