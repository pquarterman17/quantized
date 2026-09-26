// Workspace (.dwk) save/load — serialize the loaded datasets to a portable JSON document and
// parse one back, with validation. A reload otherwise loses the library (datasets live only in
// memory); this gives session persistence. Pure + testable; the App wires it to Save/Open commands (download + file picker).

import { parseFolders, pruneOrphans } from "./foldertree";
import type { OriginFidelityEntry } from "./originFidelity";
import type { OriginFigureEntry } from "./originFigures";
import { sanitizeFigureDocs, type FigureDoc } from "./figuredoc";
import {
  FIGURE_DOCUMENT_VERSION,
  figureDocumentVersion,
  sanitizeFigureDocument,
  type FigureDocument,
} from "./figureDocument";
import { sanitizePageDocuments, type PageDocument } from "./pageDocument";
import { sanitizeSteps, type PipelineStep } from "./pipeline";
import { sanitizeSavedPlotSpecs, type SavedPlotSpec } from "./plotspec";
import type { PlotRecipe } from "./plotRecipe";
import { sanitizeRecipes } from "./plotRecipeIO";
import { pruneDanglingWorkbookScopeTemplates, sanitizeQuickPlotTemplates, type QuickPlotTemplate } from "./quickPlotTemplates";
import type { PlotWindow } from "./plotview";
import type { RoiDef } from "./roi";
import type { LibrarySelection } from "../store/libraryPanel";
import { deserializeRois } from "../store/rois";
import { sanitizeMapViews, type MapViewMap } from "./mapView";
import { sanitizeDocumentBackedPlotWindows } from "./windowDocumentPersistence";
import {
  librarySelectionLiveIds,
  parseLibrarySelection,
  parseWorkbookLastChild,
} from "./workspaceLibraryPanel";
import { sanitizeTechniqueViewMemory, type TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { RecalcMode } from "./recalc";
import { sanitizeReports, type ReportEntry } from "./report";
import { sanitizeSmartFolders, type SmartFolder } from "./smartfolders";
import { sanitizeCollections, type Collection } from "./collections";
import { sanitizeVisibleDetailsColumns, type LibraryDetailsColumnKey } from "./libraryDetailsColumns";
import { sanitizeToolWindowLayout, type ToolWindowLayout } from "./toolwindow";
import { applyWorkbookMigration, sanitizeWorkbooks, type WorkbookNode } from "./workbooks";
import { parseOriginFidelity, parseOriginFigures, stringsIn } from "./workspaceOrigin";
import { parseWorkspaceDataset } from "./workspaceDatasetParse";
import { splitProjectFitModels } from "./fitModelsProject";
import type { CustomFitModel } from "./fitmodels";
import type { Dataset, FolderNode } from "./types";

export const WORKSPACE_FORMAT = "quantized-workspace";
// v2 (project-organization plan item 2): adds the folder tree, active/selection, and folder-expansion.
// v3 (gap #5): adds the typed pipeline steps, the recalc mode, per-dataset fit specs, and reports;
// later also smart folders (org #9), the plot window layout (MULTI_PLOT_PLAN item 7), and the
// ToolWindow layout registry (GUI_INTERACTION_PLAN #10) — all additive-optional, no bump needed. v4
// (LIBRARY_WORKBOOK_UX_PLAN PR A2): adds the workbook layer confirmed by L0.1 (folder -> workbook ->
// worksheet/figure/analysis/note) — `workbooks[]` plus per-dataset `workbookId`. A v1-v3 doc has
// neither field; parseWorkspace derives them the same way it already migrates folders/pipeline/etc. —
// ONE parse path for every version (lib/workbooks.ts's `deriveWorkbooks`/`reconcileWorkbookRefs`,
// ported verbatim from PR A1) — see that call site below for the exact per-version behavior, including
// the v1 `group`-string case (deliberate — see workspace.workbooks.test.ts for the pinned test). Older
// docs still load — migrated on parse with safe defaults.
// Additive-optional per-dataset records since v4, no bump needed (absent = none): `peakTable`
// (audit P2.1; own schema `version` + sanitizer, lib/peakTable.ts) and `reflFits` (P2.2 slice 3;
// passed through verbatim, each record carrying its own schema `version` and validated on read by
// workshops/reflectivity/reflFitRecord.ts's `decodeRecord`, where an unknown version is skipped).
// Additive-optional TOP-LEVEL `customFitModels` (P2.7 follow-up, lib/fitModelsProject.ts): the
// saved fit models, written only when there are any; an older build never reads the key (this
// parser picks its fields by name), so no bump.
export const WORKSPACE_VERSION = 4;
// v5 (P2.5, PR #431 review): written ONLY when the pipeline holds a `transform` step; every other
// save stays v4, so ordinary files still open in older builds. The reason is an older reader's
// `sanitizeSteps`, which silently DROPS a step kind it does not know — it would load the pipeline
// minus its transforms and then run the later steps on the input dataset instead of the transform's
// output, editing the source in place. A v1-v4 reader refuses v5 outright ("unsupported workspace
// version"), which is the safe failure. Content is otherwise identical to v4. (Templates need no
// bump: an older `parseTemplate` already rejects the whole file on an unknown step kind.)
export const WORKSPACE_VERSION_TRANSFORM_STEPS = 5;

/** The persistable slice of app state (input to serialize). The store's AppState
 *  is a structural superset, so `useApp.getState()` can be passed directly where
 *  this is expected; the extras are optional so a caller with only datasets can
 *  pass `{ datasets }`. `plotWindows` should already carry the FOCUSED window's
 *  live view frozen into its record (the store's `windowsForSave()` getter does
 *  this — never pass `state.plotWindows` raw, or the focused window's on-screen
 *  changes are lost). */
export interface WorkspaceState {
  datasets: Dataset[];
  folders?: FolderNode[];
  /** LIBRARY_WORKBOOK_UX_PLAN L0.1's middle hierarchy layer (folder ->
   *  workbook -> worksheet/figure/analysis/note). Membership rides on each
   *  dataset's `Dataset.workbookId`, not a child list here — see
   *  lib/workbooks.ts's `WorkbookNode` doc. Absent on a pre-v4 doc; a v4
   *  round-trip (`serializeWorkspace` below) always writes the array. */
  workbooks?: WorkbookNode[];
  activeId?: string | null;
  selectedIds?: string[];
  expandedFolders?: string[];
  originFigures?: OriginFigureEntry[];
  originFidelity?: OriginFidelityEntry[];
  smartFolders?: SmartFolder[];
  reports?: ReportEntry[];
  macroSteps?: PipelineStep[];
  recalcMode?: RecalcMode;
  figureDocs?: FigureDoc[];
  editableFigures?: FigureDocument[];
  /** FIGURE_AUTHORING_WORKFLOW_PLAN F3.1 — persisted multi-panel pages,
   *  panels referencing `editableFigures` ids (never a flattened copy). */
  pages?: PageDocument[];
  /** Load-time compatibility notices. Never serialized back into a .dwk. */
  migrationWarnings?: string[];
  plotWindows?: PlotWindow[];
  focusedWindowId?: string | null;
  /** GUI_INTERACTION_PLAN #10 item 3 — every floating ToolWindow's persisted
   *  position/size/collapsed, keyed by its `id` prop. */
  toolWindowLayout?: Record<string, ToolWindowLayout>;
  /** GUI_INTERACTION_PLAN #11 — every named saved Graph Builder spec. */
  savedPlotSpecs?: SavedPlotSpec[];
  /** PR H — every named saved Quick Plot template (L0.14/L0.31). Additive-optional. */
  quickPlotTemplates?: QuickPlotTemplate[];
  /** PLOT_WORKFLOW_PLAN item 5 — per-technique last-used view. Additive; a
   *  caller (or a pre-item-5 .dwk) with no field loads as `{}`. */
  techniqueViewMemory?: TechniqueViewMemoryMap;
  /** RSM_CUTS_PLAN item 13 — every named saved ROI (store/rois.ts); additive-optional, not the working mapRoi/mapRuler (see store/rois.ts). */
  savedRois?: RoiDef[];
  /** Audit P2.8 — the durable 2-D map view of EACH dataset (colour limits,
   *  colour scale, colormap, H/V/segment slice definitions with their linked
   *  positions, map annotations), keyed by dataset id. Additive-optional:
   *  absent on every pre-P2.8 doc, and `serializeWorkspace` OMITS it again
   *  whenever no dataset's view was touched, so an ordinary project
   *  round-trips byte-identically (lib/mapView.ts's `isDefaultMapViews`). The
   *  FIRST P2.8 commit wrote a single `mapView` object instead; `parseWorkspace`
   *  migrates that shape into this one. */
  mapViews?: MapViewMap;
  /** PR E2 — Library tree "current" selection, L0.6 remembered child, workbook disclosure (see lib/workspaceLibraryPanel.ts). */
  librarySelection?: LibrarySelection | null;
  workbookLastChild?: Record<string, string>;
  expandedWorkbookIds?: string[];
  /** PR L (L0.48/L0.49) — saved-search/metadata-filter Collections; additive-optional, absent = none (lib/collections.ts). */
  collections?: Collection[];
  visibleDetailsColumns?: LibraryDetailsColumnKey[]; // PR L slice 2 (L0.56) — additive-optional, absent = seven-column default
  /** P1.3 — every saved PlotRecipe scoped to this workspace (project scope); additive-optional, absent = none. */
  plotRecipes?: PlotRecipe[];
  /** P3.5 — see LoadedWorkspace's doc. Present here only so `loadWorkspace`
   *  can carry a parse result through this (wider) type; NEVER serialized —
   *  `WorkspaceDoc` has no such field, and `serializeWorkspace` picks its
   *  fields explicitly, so it cannot reach a saved project. */
  recipeSourcesComplete?: boolean;
  /** P2.7 follow-up: the project's fit-model records the local library does
   *  not hold (unreadable, or refused) — written back on save after the
   *  library, which a save always reads itself (lib/fitModelsProject.ts).
   *  There is deliberately NO field here for the models to embed: a parsed
   *  file's models are `LoadedWorkspace.projectFitModels`, which
   *  `serializeWorkspace` never reads. */
  fitModelCarry?: unknown[];
}

/** A parsed workspace — every field populated (folder tree defaults to empty,
 *  active/selection defaulted from the datasets). Assignable to WorkspaceState. */
export interface LoadedWorkspace {
  datasets: Dataset[];
  folders: FolderNode[];
  /** Always populated — derived (v1-v3) or sanitized+reconciled (v4). See
   *  WorkspaceState.workbooks. */
  workbooks: WorkbookNode[];
  activeId: string | null;
  selectedIds: string[];
  expandedFolders: string[];
  originFigures: OriginFigureEntry[];
  originFidelity: OriginFidelityEntry[];
  smartFolders: SmartFolder[];
  reports: ReportEntry[];
  macroSteps: PipelineStep[];
  recalcMode: RecalcMode;
  figureDocs: FigureDoc[];
  editableFigures: FigureDocument[];
  pages: PageDocument[];
  /** Compatibility notices produced while parsing this workspace; transient. */
  migrationWarnings: string[];
  plotWindows: PlotWindow[];
  focusedWindowId: string | null;
  toolWindowLayout: Record<string, ToolWindowLayout>;
  savedPlotSpecs: SavedPlotSpec[];
  techniqueViewMemory: TechniqueViewMemoryMap;
  savedRois: RoiDef[];
  /** P2.8 — `parseWorkspace` ALWAYS populates this (the empty record when the
   *  doc has no field, or a malformed one). Declared optional, unlike its
   *  always-populated neighbours, only so the hand-built `LoadedWorkspace`
   *  fixtures scattered through the suite stay valid without restating a
   *  field they do not exercise. */
  mapViews?: MapViewMap;
  quickPlotTemplates: QuickPlotTemplate[]; // PR H — always populated
  /** PR E2 — see WorkspaceState's doc; always populated. */
  librarySelection: LibrarySelection | null;
  workbookLastChild: Record<string, string>;
  expandedWorkbookIds: string[];
  collections: Collection[]; // PR L — always populated
  visibleDetailsColumns: LibraryDetailsColumnKey[]; // PR L slice 2 — always populated
  plotRecipes: PlotRecipe[]; // P1.3 — always populated
  /** Were `plotRecipes` and `quickPlotTemplates` read from this file WHOLE?
   *  (Saved fit models are judged by the store from `fitModelCarry` instead —
   *  store/recipeFidelity.ts's `recipeSourcesWhole` — so the carry and the
   *  verdict can never disagree after an undo.)
   *
   *  False when either field was present but not an array, or when its
   *  sanitizer dropped a record. Transient and derived — never serialized (it
   *  is absent from `WorkspaceDoc`, so it cannot round-trip into a saved
   *  project), and re-derived on every parse.
   *
   *  The Recipe Library is the consumer: it combines this with the global
   *  slot's own signal, and a false anywhere makes the collection unsafe to
   *  prune sidecar favorites/tags against. See `slotFidelity` for why the
   *  measurement happens BEFORE the dangling-scope prune. */
  recipeSourcesComplete: boolean;
  /** P2.7 follow-up: the file's readable saved fit models, merged into the
   *  local library by the store's load/append (`adoptProjectFitModels`) and
   *  NEVER serialized from here (a save reads the library), and the
   *  unreadable ones, carried. Always populated by `parseWorkspace`; optional
   *  only for the hand-built fixtures, like `mapViews`. */
  projectFitModels?: CustomFitModel[];
  fitModelCarry?: unknown[];
}


/** Future editable schemas are skipped; malformed v1 and duplicate ids are dropped. */
function parseEditableFigures(value: unknown, datasetIds: ReadonlySet<string>, migrationWarnings: string[]): FigureDocument[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const documents: FigureDocument[] = [];
  for (const candidate of value) {
    const version = figureDocumentVersion(candidate);
    if (version !== null && version > FIGURE_DOCUMENT_VERSION) {
      const candidateId =
        typeof candidate === "object" && candidate !== null
          ? (candidate as Record<string, unknown>).id
          : undefined;
      const id = typeof candidateId === "string" ? ` "${candidateId}"` : "";
      migrationWarnings.push(`skipped saved FigureDocument${id} with unsupported version ${version}`);
      continue;
    }
    const document = sanitizeFigureDocument(candidate);
    if (!document || seen.has(document.id)) continue;
    seen.add(document.id);
    documents.push(
      document.bindings.datasetId && !datasetIds.has(document.bindings.datasetId)
        ? { ...document, bindings: { ...document.bindings, datasetId: null } }
        : document,
    );
  }
  return documents;
}

/** Did one .dwk recipe array survive its sanitizer intact?
 *
 *  Mirrors `lib/recipeSources.ts`'s `slotComplete` deliberately, because the
 *  Recipe Library combines both answers into one `complete` flag and they have
 *  to mean the same thing: an ABSENT field is a whole (empty) source; a
 *  non-array is a source we could not read; and an array the sanitizer
 *  SHORTENED is the dangerous case — those records still exist in the file,
 *  so a consumer pruning sidecar metadata against the loaded list would delete
 *  the favorites and tags of recipes that are merely missing from THIS read.
 *
 *  ABSENT means `undefined` — the key is not in the document — and ONLY that.
 *  An explicit `null` is present, is not an array, and so is a shape we did
 *  not understand. Getting this wrong is easy because `slotComplete` appears
 *  to accept null: its `raw === null` is `localStorage.getItem` reporting the
 *  key ABSENT, whereas a STORED JSON `null` parses to `null` there and fails
 *  the same `Array.isArray` check this one does. No real save can produce it
 *  either way — `serializeWorkspace` writes `?? []` for both fields — so a
 *  `null` here came from a hand-edited or truncated file, which is precisely
 *  when certifying completeness is destructive.
 *
 *  `loaded` must be the sanitize output's length, never a later filtered one:
 *  see the two-step quick-plot-template call in `parseWorkspace`. */
function slotFidelity(raw: unknown, loaded: number): boolean {
  if (raw === undefined) return true;
  if (!Array.isArray(raw)) return false; // null included — present, wrong shape
  return raw.length === loaded;
}

/** Parse a .dwk document into the full workspace state, throwing a clear error on
 *  anything malformed (bad JSON, wrong format/version, or an invalid DataStruct).
 *  v1 docs (datasets only) load with an empty folder tree (migration).
 *  `viewport` (GUI_INTERACTION_PLAN #10 item 3) is only for clamping a
 *  restored `toolWindowLayout` — defaults to the real browser window, so
 *  callers only pass it explicitly in tests.
 *
 *  `opts.projectDir` (P1.7 PR 3, Pack Project): the `.dwk`'s own directory
 *  on disk, when the caller actually has one — threaded to every dataset's
 *  `parseDatasetSource` so a packed project's bundle-relative sources
 *  (`kind: "bundle"` manifest entries) resolve to real absolute paths. Only
 *  a NATIVE open/reopen (a real file on a real disk) can supply this —
 *  `lib/openWorkspaceCommand.ts`'s native branch and
 *  `commands/recentProjectsCommands.ts`'s reopen both do. The browser-picker
 *  path (`lib/parseWorkspaceFile.ts`, off-main-thread via a Worker) has no
 *  durable path to derive a directory from — a `<input type=file>` pick
 *  never reveals one — so it never passes this, and any `kind: "bundle"`
 *  source in a workspace opened that way degrades to "no source" exactly
 *  like any other unresolvable one (`parseDatasetSource`'s documented
 *  fallback). Absent entirely for autosave/browser-download round trips,
 *  which only ever carry absolute `kind: "path"` sources in the first
 *  place. */
export function parseWorkspace(
  text: string,
  viewport?: { width: number; height: number },
  opts?: { projectDir?: string },
): LoadedWorkspace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("not a valid workspace file (bad JSON)");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("not a workspace file");
  }
  const o = parsed as Record<string, unknown>;
  if (o.format !== WORKSPACE_FORMAT) {
    throw new Error("not a quantized workspace (.dwk) file");
  }
  if (o.version !== 1 && o.version !== 2 && o.version !== 3 && o.version !== 4 && o.version !== 5) {
    throw new Error(`unsupported workspace version: ${String(o.version)}`);
  }
  if (!Array.isArray(o.datasets)) {
    throw new Error("workspace has no datasets");
  }
  // Per-entry parse/validate lives in lib/workspaceDatasetParse.ts (moved out
  // under the MODULE_PINS ratchet — see that file's header); it throws the
  // same per-index errors this inline callback used to.
  const datasetsRaw = o.datasets.map((d, i) => parseWorkspaceDataset(d, i, opts?.projectDir));

  // Folder tree (absent in v1 → empty). Prune datasets pointing at a folder that
  // didn't survive validation; clamp active/selection/expansion to live ids.
  const folders = parseFolders(o.folders);
  const datasets = pruneOrphans(folders, datasetsRaw);
  const dsIds = new Set(datasets.map((d) => d.id));
  const folderIds = new Set(folders.map((f) => f.id));
  const migrationWarnings: string[] = [];
  const selectedIds = stringsIn(o.selectedIds, dsIds);
  const activeId =
    typeof o.activeId === "string" && dsIds.has(o.activeId) ? o.activeId : (datasets[0]?.id ?? null);
  const rawExpandedFolders = stringsIn(o.expandedFolders, folderIds);
  // Workbooks (v4, LIBRARY_WORKBOOK_UX_PLAN PR A2/A3). ONE path for every
  // version: sanitize whatever `workbooks[]` the doc carries (absent on a
  // v1-v3 doc -> []), then lib/workbooks.ts's `applyWorkbookMigration`
  // repairs/derives membership for every dataset AND converts any pre-A3
  // book-surrogate folder into its replacement workbook (dropping the
  // folder, re-homing its former occupants to its parent) — see that
  // function's doc for the deterministic `wbm-N` id counter and the v1
  // group-string caveat (no folders exist yet at parse time, so such a
  // doc's derived workbooks land at the Library root — still correct, just
  // unplaced; folder promotion happens later, in the STORE's
  // `loadWorkspace` -> `migrateGroupsToFolders`).
  const workbooksSanitized = sanitizeWorkbooks(o.workbooks, folderIds, opts?.projectDir);
  const migration = applyWorkbookMigration(datasets, folders, rawExpandedFolders, workbooksSanitized);
  const workbooks = migration.workbooks;
  migrationWarnings.push(...migration.warnings);
  const originFigures = parseOriginFigures(o.originFigures, dsIds);
  const originFidelity = parseOriginFidelity(o.originFidelity, dsIds);
  const smartFolders = sanitizeSmartFolders(o.smartFolders);
  const reports = sanitizeReports(o.reports, dsIds);
  const macroSteps = sanitizeSteps(o.pipeline);
  const recalcMode: RecalcMode =
    o.recalcMode === "manual" || o.recalcMode === "off" ? o.recalcMode : "auto";
  // Legacy Publication Preview FigureDocs stay unchanged until F2 preserves their unsupported overrides.
  const figureDocs = sanitizeFigureDocs(o.figureDocs, dsIds);
  const editableFigures = parseEditableFigures(o.editableFigures, dsIds, migrationWarnings);
  const pages = sanitizePageDocuments(o.pages);
  const plotWindows = sanitizeDocumentBackedPlotWindows(o.plotWindows, dsIds, migrationWarnings, viewport);
  const focusedWindowId =
    typeof o.focusedWindowId === "string" &&
    plotWindows.some((w) => w.id === o.focusedWindowId && w.kind === "plot")
      ? o.focusedWindowId
      : null;
  const toolWindowLayout = sanitizeToolWindowLayout(o.toolWindowLayout, viewport);
  const savedPlotSpecs = sanitizeSavedPlotSpecs(o.savedPlotSpecs);
  const workbookIds = new Set(workbooks.map((w) => w.id)); // PR E2 — hoisted for the H-review dangling-scope prune below
  // Kept as two steps, deliberately: `recipeSourceFidelity` below measures
  // against the SANITIZE output, never the post-prune one. Sanitizing drops a
  // record it could not read (a fidelity failure the user must be told about);
  // pruning drops a template whose workbook the user themselves deleted (a
  // decision, on a file that was read perfectly). Folding these back into one
  // expression is what made deleting a workbook announce "some recipe sources
  // could not be read completely" with nothing wrong.
  const sanitizedQuickPlotTemplates = sanitizeQuickPlotTemplates(o.quickPlotTemplates);
  const quickPlotTemplates = pruneDanglingWorkbookScopeTemplates(sanitizedQuickPlotTemplates, workbookIds);
  const techniqueViewMemory = sanitizeTechniqueViewMemory(o.techniqueViewMemory);
  // RSM_CUTS_PLAN item 13: a malformed/hand-edited entry is skipped (named in
  // migrationWarnings), never thrown — same degrade as editableFigures/plotWindows above.
  const savedRois = deserializeRois(o.savedRois, migrationWarnings);
  // P2.8: drop-malformed-never-throw, same degrade as `savedRois` right above.
  // `dsIds` is passed so an entry keyed by a dataset this load did NOT keep is
  // discarded rather than rebound onto whatever map opens next — its colour
  // limits and slice positions are in the missing map's own units. `o.mapView`
  // is the FIRST P2.8 commit's single-object shape, migrated by the sanitizer.
  const mapViews = sanitizeMapViews(o.mapViews ?? o.mapView, dsIds);
  const librarySelection = parseLibrarySelection(
    o.librarySelection,
    selectedIds,
    librarySelectionLiveIds({ folders: migration.folders, workbooks, originFigures, editableFigures, figureDocs, pages, reports }),
  );
  const workbookLastChild = parseWorkbookLastChild(o.workbookLastChild, workbookIds);
  const expandedWorkbookIds = stringsIn(o.expandedWorkbookIds, workbookIds);
  const collections = sanitizeCollections(o.collections);
  const plotRecipes = sanitizeRecipes(o.plotRecipes); // P1.3 — drop-malformed-never-throw, same as sanitizeQuickPlotTemplates
  // P2.7 follow-up: an unreadable embedded fit model is carried; the store
  // derives the Recipe Library's completeness from that carry.
  const fitModels = splitProjectFitModels(o.customFitModels, migrationWarnings);
  const recipeSourcesComplete =
    slotFidelity(o.plotRecipes, plotRecipes.length) &&
    slotFidelity(o.quickPlotTemplates, sanitizedQuickPlotTemplates.length);
  return {
    datasets,
    folders: migration.folders,
    workbooks,
    activeId,
    selectedIds,
    expandedFolders: migration.expandedFolders,
    originFigures,
    originFidelity,
    smartFolders,
    reports,
    macroSteps,
    recalcMode,
    figureDocs,
    editableFigures,
    pages,
    migrationWarnings,
    plotWindows,
    focusedWindowId,
    toolWindowLayout,
    savedPlotSpecs,
    techniqueViewMemory,
    savedRois,
    mapViews,
    quickPlotTemplates,
    librarySelection,
    workbookLastChild,
    expandedWorkbookIds,
    collections,
    visibleDetailsColumns: sanitizeVisibleDetailsColumns(o.visibleDetailsColumns),
    plotRecipes,
    recipeSourcesComplete,
    projectFitModels: fitModels.models,
    fitModelCarry: fitModels.carry,
  };
}

// Append-a-second-workspace ("Append Project") — `mergeWorkspace` +
// `WorkspaceMergeResult` — lives in ./workspaceMerge.ts (moved out under the
// RSM_CUTS_PLAN item 13 size ratchet: it was already fully self-contained,
// with store/workspaceIO.ts as its only external caller, so extracting it
// funds the named-ROI hook-in below without that caller needing to change).
export * from "./workspaceMerge";

// The .dwk WRITE side (`serializeWorkspace` + the private `WorkspaceDoc`) —
// extracted to ./workspaceSerialize.ts under this file's size pin, re-exported
// here so every caller keeps importing it from `lib/workspace`.
export * from "./workspaceSerialize";

// The store's load/append reach the fit-model merge through this (already
// loaded) codec rather than a chunk of their own — lib/fitModelsProject.ts.
export { adoptProjectFitModels, autosaveRestoreFitModels } from "./fitModelsProject";
