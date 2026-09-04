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
export const WORKSPACE_VERSION = 4;

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
  quickPlotTemplates: QuickPlotTemplate[]; // PR H — always populated
  /** PR E2 — see WorkspaceState's doc; always populated. */
  librarySelection: LibrarySelection | null;
  workbookLastChild: Record<string, string>;
  expandedWorkbookIds: string[];
  collections: Collection[]; // PR L — always populated
  visibleDetailsColumns: LibraryDetailsColumnKey[]; // PR L slice 2 — always populated
  plotRecipes: PlotRecipe[]; // P1.3 — always populated
  /** Were `plotRecipes` and `quickPlotTemplates` read from this file WHOLE?
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
 *  callers only pass it explicitly in tests. */
export function parseWorkspace(
  text: string,
  viewport?: { width: number; height: number },
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
  if (o.version !== 1 && o.version !== 2 && o.version !== 3 && o.version !== 4) {
    throw new Error(`unsupported workspace version: ${String(o.version)}`);
  }
  if (!Array.isArray(o.datasets)) {
    throw new Error("workspace has no datasets");
  }
  // Per-entry parse/validate lives in lib/workspaceDatasetParse.ts (moved out
  // under the MODULE_PINS ratchet — see that file's header); it throws the
  // same per-index errors this inline callback used to.
  const datasetsRaw = o.datasets.map((d, i) => parseWorkspaceDataset(d, i));

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
  const workbooksSanitized = sanitizeWorkbooks(o.workbooks, folderIds);
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
  const librarySelection = parseLibrarySelection(
    o.librarySelection,
    selectedIds,
    librarySelectionLiveIds({ folders: migration.folders, workbooks, originFigures, editableFigures, figureDocs, pages, reports }),
  );
  const workbookLastChild = parseWorkbookLastChild(o.workbookLastChild, workbookIds);
  const expandedWorkbookIds = stringsIn(o.expandedWorkbookIds, workbookIds);
  const collections = sanitizeCollections(o.collections);
  const plotRecipes = sanitizeRecipes(o.plotRecipes); // P1.3 — drop-malformed-never-throw, same as sanitizeQuickPlotTemplates
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
    quickPlotTemplates,
    librarySelection,
    workbookLastChild,
    expandedWorkbookIds,
    collections,
    visibleDetailsColumns: sanitizeVisibleDetailsColumns(o.visibleDetailsColumns),
    plotRecipes,
    recipeSourcesComplete,
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
