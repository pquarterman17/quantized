// Workspace (.dwk) save/load — serialize the loaded datasets to a portable JSON
// document and parse one back, with validation. A reload otherwise loses the
// library (datasets live only in memory); this gives session persistence. Pure +
// testable; the App wires it to Save/Open commands (download + file picker).

import { sanitizeFilter } from "./datafilter";
import { sanitizeBindings } from "./errorRoles";
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
import type { PlotWindow } from "./plotview";
import type { RoiDef } from "./roi";
import type { LibrarySelection } from "../store/libraryPanel";
import { deserializeRois, serializeRois } from "../store/rois";
import { sanitizeDocumentBackedPlotWindows } from "./windowDocumentPersistence";
import {
  librarySelectionLiveIds,
  parseLibrarySelection,
  parseWorkbookLastChild,
} from "./workspaceLibraryPanel";
import { sanitizeTechniqueViewMemory, type TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { RecalcMode } from "./recalc";
import { sanitizeReports, type ReportEntry } from "./report";
import { sanitizeExcluded } from "./rowstate";
import { sanitizeSmartFolders, type SmartFolder } from "./smartfolders";
import { sanitizeToolWindowLayout, type ToolWindowLayout } from "./toolwindow";
import { applyWorkbookMigration, sanitizeWorkbooks, type WorkbookNode } from "./workbooks";
import { parseOriginFidelity, parseOriginFigures, stringsIn } from "./workspaceOrigin";
import type {
  BookSource,
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  Dataset,
  DataStruct,
  FitSpec,
  FitWeighting,
  FolderNode,
  ModelingType,
  WeightMode,
} from "./types";

export const WORKSPACE_FORMAT = "quantized-workspace";
// v2 (project-organization plan item 2): adds the folder tree, active/selection,
// and folder-expansion. v3 (gap #5): adds the typed pipeline steps, the recalc
// mode, per-dataset fit specs, and reports; later also smart folders (org #9),
// the plot window layout (MULTI_PLOT_PLAN item 7), and the ToolWindow layout
// registry (GUI_INTERACTION_PLAN #10) — all additive-optional, no bump needed.
// v4 (LIBRARY_WORKBOOK_UX_PLAN PR A2): adds the workbook layer confirmed by
// L0.1 (folder -> workbook -> worksheet/figure/analysis/note) — `workbooks[]`
// plus per-dataset `workbookId`. A v1-v3 doc has neither field; parseWorkspace
// derives them the same way it already migrates folders/pipeline/etc. — ONE
// parse path for every version (lib/workbooks.ts's `deriveWorkbooks`/
// `reconcileWorkbookRefs`, ported verbatim from PR A1). See that call site
// below for the exact per-version behavior, including the v1 `group`-string
// case (deliberate — see workspace.workbooks.test.ts for the pinned test).
// Older docs still load — migrated on parse with safe defaults.
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
  /** PLOT_WORKFLOW_PLAN item 5 — per-technique last-used view. Additive; a
   *  caller (or a pre-item-5 .dwk) with no field loads as `{}`. */
  techniqueViewMemory?: TechniqueViewMemoryMap;
  /** RSM_CUTS_PLAN item 13 — every named saved ROI (box/ruler/sector; store/
   *  rois.ts's `savedRois`). Additive-optional, so a pre-item-13 .dwk loads
   *  with an empty list. Deliberately NOT the working `mapRoi`/`mapRuler` —
   *  see store/rois.ts's header for why only the NAMED, saved definitions
   *  round-trip through a restart. */
  savedRois?: RoiDef[];
  /** PR E2 (LIBRARY_WORKBOOK_UX_PLAN) — the Library tree's "current"
   *  selection, L0.6 remembered child, and workbook disclosure. See
   *  store/libraryPanel.ts and lib/workspaceLibraryPanel.ts's validators. */
  librarySelection?: LibrarySelection | null;
  workbookLastChild?: Record<string, string>;
  expandedWorkbookIds?: string[];
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
  /** PR E2 — see WorkspaceState's doc; always populated. */
  librarySelection: LibrarySelection | null;
  workbookLastChild: Record<string, string>;
  expandedWorkbookIds: string[];
}

interface WorkspaceDoc {
  format: string;
  version: number;
  savedAt: string;
  datasets: Dataset[];
  folders: FolderNode[];
  workbooks: WorkbookNode[];
  activeId: string | null;
  selectedIds: string[];
  expandedFolders: string[];
  originFigures: OriginFigureEntry[];
  originFidelity: OriginFidelityEntry[];
  smartFolders: SmartFolder[];
  reports: ReportEntry[];
  pipeline: PipelineStep[];
  recalcMode: RecalcMode;
  figureDocs: FigureDoc[];
  editableFigures: FigureDocument[];
  pages: PageDocument[];
  plotWindows: PlotWindow[];
  focusedWindowId: string | null;
  toolWindowLayout: Record<string, ToolWindowLayout>;
  savedPlotSpecs: SavedPlotSpec[];
  techniqueViewMemory: TechniqueViewMemoryMap;
  savedRois: RoiDef[];
  librarySelection: LibrarySelection | null;
  workbookLastChild: Record<string, string>;
  expandedWorkbookIds: string[];
}

/** Serialize the library + folder tree to a pretty-printed .dwk JSON document. */
export function serializeWorkspace(ws: WorkspaceState): string {
  const doc: WorkspaceDoc = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    folders: ws.folders ?? [],
    workbooks: ws.workbooks ?? [],
    activeId: ws.activeId ?? null,
    selectedIds: ws.selectedIds ?? [],
    expandedFolders: ws.expandedFolders ?? [],
    originFigures: ws.originFigures ?? [],
    originFidelity: ws.originFidelity ?? [],
    smartFolders: ws.smartFolders ?? [],
    reports: ws.reports ?? [],
    pipeline: ws.macroSteps ?? [],
    recalcMode: ws.recalcMode ?? "auto",
    figureDocs: ws.figureDocs ?? [],
    editableFigures: ws.editableFigures ?? [],
    pages: ws.pages ?? [],
    // MULTI_PLOT_PLAN item 7: passed through VERBATIM — the caller (the
    // store's `windowsForSave()`, per the interface doc above) is
    // responsible for the focused window's live-view snapshot; this module
    // stays a plain serializer, same as every other field here.
    plotWindows: ws.plotWindows ?? [],
    focusedWindowId: ws.focusedWindowId ?? null,
    toolWindowLayout: ws.toolWindowLayout ?? {},
    savedPlotSpecs: ws.savedPlotSpecs ?? [],
    // PLOT_WORKFLOW_PLAN item 5: passed through verbatim, same convention as
    // `plotWindows` above — the caller (windowsForSave()'s save-time-freshen
    // sibling, `captureTechniqueView` applied to the live view) owns the fold.
    techniqueViewMemory: ws.techniqueViewMemory ?? {},
    // RSM_CUTS_PLAN item 13: named ROIs only (see WorkspaceState's doc) — the
    // actual (de)serialize logic lives in store/rois.ts, this module just calls it.
    savedRois: serializeRois(ws.savedRois ?? []),
    // PR E2: passed through verbatim, same plain-serializer convention as
    // every other field here.
    librarySelection: ws.librarySelection ?? null,
    workbookLastChild: ws.workbookLastChild ?? {},
    expandedWorkbookIds: ws.expandedWorkbookIds ?? [],
    datasets: ws.datasets.map((d) => ({
      id: d.id,
      name: d.name,
      data: d.data,
      ...(d.raw ? { raw: d.raw } : {}),
      ...(d.corrections ? { corrections: d.corrections } : {}),
      ...(d.bgRef ? { bgRef: d.bgRef } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
      ...(d.tags?.length ? { tags: d.tags } : {}),
      ...(d.group?.trim() ? { group: d.group } : {}),
      ...(d.folderId ? { folderId: d.folderId } : {}),
      ...(d.workbookId ? { workbookId: d.workbookId } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.formulas?.length ? { formulas: d.formulas } : {}),
      ...(d.errorRoles?.length ? { errorRoles: d.errorRoles } : {}),
      ...(d.importedAt ? { importedAt: d.importedAt } : {}),
      ...(d.channelRoles && Object.keys(d.channelRoles).length
        ? { channelRoles: d.channelRoles }
        : {}),
      ...(d.channelTypes && Object.keys(d.channelTypes).length
        ? { channelTypes: d.channelTypes }
        : {}),
      ...(d.excludedRows?.length ? { excludedRows: d.excludedRows } : {}),
      ...(d.filter?.length ? { filter: d.filter } : {}),
      ...(d.fitSpec ? { fitSpec: d.fitSpec } : {}),
      // ORIGIN_FILE_DECODE_PLAN #38: an explicit "Save workspace (.dwk)…"
      // resolves every pending dataset FIRST (App.tsx's save command calls
      // `resolvePendingDatasets` before this runs), so `d.pending` is never
      // set in a real exported .dwk — only autosave (lib/autosave.ts, which
      // reuses this same serializer for its localStorage snapshot) can
      // legitimately still have one, and it's fine for that round-trip to
      // carry it: the render-side ensureBookData hooks re-fetch it the next
      // time that dataset is shown after a reload.
      ...(d.pending ? { pending: d.pending } : {}),
      ...(d.source ? { source: d.source } : {}),
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/** Future editable schemas are skipped; malformed v1 and duplicate ids are dropped. */
function parseEditableFigures(value: unknown, datasetIds: ReadonlySet<string>, migrationWarnings: string[]): FigureDocument[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const documents: FigureDocument[] = [];
  for (const candidate of value) {
    const version = figureDocumentVersion(candidate);
    if (version !== null && version > FIGURE_DOCUMENT_VERSION) {
      const id = typeof candidate === "object" && candidate !== null && typeof (candidate as Record<string, unknown>).id === "string" ? ` "${(candidate as Record<string, unknown>).id}"` : "";
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

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

/** Validate a persisted `Dataset.pending` (#38) — a stale/hand-edited value
 *  degrades to "not pending" (the dataset then just shows whatever rows its
 *  `data` happens to carry) rather than throwing. */
function parsePending(v: unknown): BookSource | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.bookId !== "string" || !o.bookId) return null;
  const rows = typeof o.rows === "number" && Number.isFinite(o.rows) ? o.rows : 0;
  const cols = typeof o.cols === "number" && Number.isFinite(o.cols) ? o.cols : 0;
  if (o.kind === "path" && typeof o.path === "string" && o.path) {
    return { kind: "path", path: o.path, bookId: o.bookId, rows, cols };
  }
  if (o.kind === "upload" && typeof o.token === "string" && o.token) {
    return { kind: "upload", token: o.token, bookId: o.bookId, rows, cols };
  }
  return null;
}

/** Validate a persisted `Dataset.source` (MAIN_PLAN #10) — a stale/hand-edited
 *  value degrades to "no source" (the dataset just falls back to "Re-import
 *  from file…") rather than throwing. */
function parseSource(v: unknown): { kind: "path"; path: string } | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "path" && typeof o.path === "string" && o.path) {
    return { kind: "path", path: o.path };
  }
  return null;
}

/** Structural check that `v` is a DataStruct (time/values/labels/units/metadata). */
function isDataStruct(v: unknown): v is DataStruct {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isNumberArray(o.time) &&
    Array.isArray(o.values) &&
    o.values.every((row) => isNumberArray(row)) &&
    Array.isArray(o.labels) &&
    o.labels.every((s) => typeof s === "string") &&
    Array.isArray(o.units) &&
    o.units.every((s) => typeof s === "string") &&
    typeof o.metadata === "object" &&
    o.metadata !== null
  );
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
  const datasetsRaw = o.datasets.map((d, i): Dataset => {
    if (typeof d !== "object" || d === null) {
      throw new Error(`dataset ${i} is invalid`);
    }
    const dd = d as Record<string, unknown>;
    if (!isDataStruct(dd.data)) {
      throw new Error(`dataset ${i} ("${String(dd.name ?? "")}") has an invalid data structure`);
    }
    const ds: Dataset = {
      id: typeof dd.id === "string" ? dd.id : `ws-${i}`,
      name: typeof dd.name === "string" ? dd.name : `dataset ${i + 1}`,
      data: dd.data,
    };
    if (isDataStruct(dd.raw)) ds.raw = dd.raw;
    if (dd.corrections && typeof dd.corrections === "object") {
      ds.corrections = dd.corrections as CorrectionParams;
    }
    if (
      dd.bgRef &&
      typeof dd.bgRef === "object" &&
      typeof (dd.bgRef as Record<string, unknown>).datasetId === "string"
    ) {
      ds.bgRef = dd.bgRef as { datasetId: string; interp: string };
    }
    if (typeof dd.notes === "string") ds.notes = dd.notes;
    if (Array.isArray(dd.tags)) {
      const tags = dd.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "");
      if (tags.length) ds.tags = tags;
    }
    if (typeof dd.group === "string" && dd.group.trim()) ds.group = dd.group;
    if (Array.isArray(dd.formulas)) {
      const formulas = dd.formulas.filter(
        (f): f is ComputedColumn =>
          typeof f === "object" &&
          f !== null &&
          typeof (f as Record<string, unknown>).name === "string" &&
          typeof (f as Record<string, unknown>).expr === "string",
      );
      if (formulas.length) ds.formulas = formulas;
    }
    // MAIN #33: error roles survive save/reapply, but are re-validated
    // against the CURRENT channel count — a template reapplied to a
    // differently-shaped source must not bind error bars to whatever column
    // now happens to sit at that index.
    const bindings = sanitizeBindings(dd.errorRoles, ds.data.labels.length);
    if (bindings?.length) ds.errorRoles = bindings;
    if (typeof dd.importedAt === "string") ds.importedAt = dd.importedAt;
    if (dd.channelRoles && typeof dd.channelRoles === "object") {
      const roles: Record<number, ChannelRole> = {};
      for (const [k, v] of Object.entries(dd.channelRoles as Record<string, unknown>)) {
        if ((v === "label" || v === "ignore") && Number.isInteger(Number(k))) {
          roles[Number(k)] = v;
        }
      }
      if (Object.keys(roles).length) ds.channelRoles = roles;
    }
    if (dd.channelTypes && typeof dd.channelTypes === "object") {
      const types: Record<number, ModelingType> = {};
      for (const [k, v] of Object.entries(dd.channelTypes as Record<string, unknown>)) {
        if (
          (v === "continuous" || v === "ordinal" || v === "nominal") &&
          Number.isInteger(Number(k))
        ) {
          types[Number(k)] = v;
        }
      }
      if (Object.keys(types).length) ds.channelTypes = types;
    }
    // Row exclusions (#50): clamp to the loaded row count — a hand-edited or
    // stale .dwk could carry out-of-range indices.
    const excluded = sanitizeExcluded(dd.excludedRows, ds.data.time.length);
    if (excluded.length) ds.excludedRows = excluded;
    // Local data filter (#53): validate predicate columns against the channels.
    const filter = sanitizeFilter(dd.filter, ds.data.labels.length);
    if (filter.length) ds.filter = filter;
    if (
      dd.fitSpec &&
      typeof dd.fitSpec === "object" &&
      typeof (dd.fitSpec as Record<string, unknown>).model === "string"
    ) {
      const fs = dd.fitSpec as Record<string, unknown>;
      const spec: FitSpec = { model: fs.model as string };
      // Provenance fields (audit P1 #3), each validated; absent = legacy v1.
      if (fs.xKey === null || (typeof fs.xKey === "number" && Number.isInteger(fs.xKey))) {
        spec.xKey = fs.xKey as number | null;
      }
      if (typeof fs.yKey === "number" && Number.isInteger(fs.yKey) && fs.yKey >= 0) {
        spec.yKey = fs.yKey;
      }
      // Weighting provenance (Sol audit); validated, non-`none` only.
      const wm = (fs.weight as Record<string, unknown> | undefined)?.mode;
      if (
        fs.weight &&
        typeof fs.weight === "object" &&
        (["yerr", "poisson", "manual"] as WeightMode[]).includes(wm as WeightMode)
      ) {
        const w = fs.weight as Record<string, unknown>;
        const weight: FitWeighting = { mode: wm as WeightMode };
        if (typeof w.errKey === "number" && Number.isInteger(w.errKey) && w.errKey >= 0) {
          weight.errKey = w.errKey;
        }
        spec.weight = weight;
      }
      if (Array.isArray(fs.params) && fs.params.every((v) => typeof v === "number")) {
        spec.params = fs.params as number[];
      }
      if (typeof fs.exitFlag === "number") spec.exitFlag = fs.exitFlag;
      ds.fitSpec = spec;
    }
    // Lazy per-book reference (#38) — only ever present in an autosave
    // snapshot (a real "Save workspace" export always resolves it first);
    // validated the same defensive way as every other optional field here.
    const pending = parsePending(dd.pending);
    if (pending) ds.pending = pending;
    const source = parseSource(dd.source);
    if (source) ds.source = source;
    if (typeof dd.folderId === "string") ds.folderId = dd.folderId;
    // Raw parse only — reconcileWorkbookRefs (below, after folders/datasets are
    // pruned) is the single place that decides whether this survives, is
    // repaired, or is replaced; see WORKSPACE_VERSION's v4 comment above.
    if (typeof dd.workbookId === "string" && dd.workbookId) ds.workbookId = dd.workbookId;
    if (typeof dd.order === "number" && Number.isFinite(dd.order)) ds.order = dd.order;
    return ds;
  });

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
  const techniqueViewMemory = sanitizeTechniqueViewMemory(o.techniqueViewMemory);
  // RSM_CUTS_PLAN item 13: a malformed/hand-edited entry is skipped (named in
  // migrationWarnings), never thrown — same degrade as editableFigures/plotWindows above.
  const savedRois = deserializeRois(o.savedRois, migrationWarnings);
  // PR E2 — `workbookIds` is the same set `workbooks` above already carries.
  const workbookIds = new Set(workbooks.map((w) => w.id));
  const librarySelection = parseLibrarySelection(
    o.librarySelection,
    selectedIds,
    librarySelectionLiveIds({ folders: migration.folders, workbooks, originFigures, editableFigures, figureDocs, pages, reports }),
  );
  const workbookLastChild = parseWorkbookLastChild(o.workbookLastChild, workbookIds);
  const expandedWorkbookIds = stringsIn(o.expandedWorkbookIds, workbookIds);
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
    librarySelection,
    workbookLastChild,
    expandedWorkbookIds,
  };
}

// Append-a-second-workspace ("Append Project") — `mergeWorkspace` +
// `WorkspaceMergeResult` — lives in ./workspaceMerge.ts (moved out under the
// RSM_CUTS_PLAN item 13 size ratchet: it was already fully self-contained,
// with store/workspaceIO.ts as its only external caller, so extracting it
// funds the named-ROI hook-in below without that caller needing to change).
export * from "./workspaceMerge";
