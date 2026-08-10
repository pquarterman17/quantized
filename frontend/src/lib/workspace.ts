// Workspace (.dwk) save/load — serialize the loaded datasets to a portable JSON
// document and parse one back, with validation. A reload otherwise loses the
// library (datasets live only in memory); this gives session persistence. Pure +
// testable; the App wires it to Save/Open commands (download + file picker).

import { sanitizeFilter } from "./datafilter";
import { sanitizeBindings } from "./errorRoles";
import { pruneOrphans } from "./foldertree";
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
import { sanitizeDocumentBackedPlotWindows } from "./windowDocumentPersistence";
import { sanitizeTechniqueViewMemory, type TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { RecalcMode } from "./recalc";
import { sanitizeReports, type ReportEntry } from "./report";
import { sanitizeExcluded } from "./rowstate";
import { sanitizeSmartFolders, type SmartFolder } from "./smartfolders";
import { sanitizeToolWindowLayout, type ToolWindowLayout } from "./toolwindow";
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
  OriginFidelityManifest,
  WeightMode,
} from "./types";

export const WORKSPACE_FORMAT = "quantized-workspace";
// v2 (project-organization plan item 2): adds the folder tree, active/selection,
// and folder-expansion. v3 (gap #5): adds the typed pipeline steps, the recalc
// mode, per-dataset fit specs, and reports; later also smart folders (org #9),
// the plot window layout (MULTI_PLOT_PLAN item 7), and the ToolWindow layout
// registry (GUI_INTERACTION_PLAN #10) — all additive-optional, no bump needed.
// Older docs still load — migrated on parse with safe defaults.
export const WORKSPACE_VERSION = 3;

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
}

/** A parsed workspace — every field populated (folder tree defaults to empty,
 *  active/selection defaulted from the datasets). Assignable to WorkspaceState. */
export interface LoadedWorkspace {
  datasets: Dataset[];
  folders: FolderNode[];
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
}

interface WorkspaceDoc {
  format: string;
  version: number;
  savedAt: string;
  datasets: Dataset[];
  folders: FolderNode[];
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
}

/** Serialize the library + folder tree to a pretty-printed .dwk JSON document. */
export function serializeWorkspace(ws: WorkspaceState): string {
  const doc: WorkspaceDoc = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    folders: ws.folders ?? [],
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

/** Validate a folder-node array (drops malformed entries; reparents a folder to
 *  root if its parent is missing). `notes`/`color`/`defaultTemplate` (plan
 *  #13 sub-item 4, Folder Properties) are additive-optional: present + a
 *  non-blank string carries through, absent/malformed is silently dropped —
 *  a legacy .dwk (no such fields at all) loads exactly as before. */
function parseFolders(v: unknown): FolderNode[] {
  if (!Array.isArray(v)) return [];
  const out: FolderNode[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      (o.parentId === null || typeof o.parentId === "string") &&
      typeof o.order === "number" &&
      Number.isFinite(o.order)
    ) {
      const node: FolderNode = {
        id: o.id,
        name: o.name,
        parentId: (o.parentId as string | null) ?? null,
        order: o.order,
      };
      if (typeof o.notes === "string" && o.notes.trim()) node.notes = o.notes;
      if (typeof o.color === "string" && o.color.trim()) node.color = o.color;
      if (typeof o.defaultTemplate === "string" && o.defaultTemplate.trim()) {
        node.defaultTemplate = o.defaultTemplate;
      }
      out.push(node);
    }
  }
  const ids = new Set(out.map((f) => f.id));
  return out.map((f) => (f.parentId && !ids.has(f.parentId) ? { ...f, parentId: null } : f));
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

function stringsIn(v: unknown, valid: Set<string>): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && valid.has(x)) : [];
}

/** Validate the persisted Origin-import figures, dropping malformed entries and
 *  clamping dataset references to ids that survived load — so a restored figure
 *  can never dangle onto a pruned dataset. `figure` is opaque decoded Origin
 *  data (an `OriginFigure`); it is passed through structurally rather than
 *  deep-validated, mirroring how `data` (a DataStruct) is the only structurally
 *  checked payload. */
function parseOriginFigures(v: unknown, dsIds: Set<string>): OriginFigureEntry[] {
  if (!Array.isArray(v)) return [];
  const out: OriginFigureEntry[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.stem !== "string" ||
      typeof o.figure !== "object" ||
      o.figure === null ||
      !(o.datasetId === null || typeof o.datasetId === "string")
    ) {
      continue;
    }
    const datasetId =
      typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    const siblingIds = Array.isArray(o.siblingIds)
      ? o.siblingIds.filter((x): x is string => typeof x === "string" && dsIds.has(x))
      : [];
    out.push({
      id: o.id,
      stem: o.stem,
      figure: o.figure as OriginFigureEntry["figure"],
      datasetId,
      siblingIds,
    });
  }
  return out;
}

function isOriginFidelityManifest(v: unknown): v is OriginFidelityManifest {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    (o.container === "opj" || o.container === "opju") &&
    ["exact", "best_effort", "reference_only", "unresolved"].includes(String(o.status)) &&
    Number.isInteger(o.graph_records_total) && Number(o.graph_records_total) >= 0 &&
    Number.isInteger(o.graph_records_actionable) && Number(o.graph_records_actionable) >= 0 &&
    Number.isInteger(o.graph_records_filtered) && Number(o.graph_records_filtered) >= 0 &&
    Array.isArray(o.omissions) &&
    o.omissions.every((x) => typeof x === "string") &&
    Array.isArray(o.filtered_figures) &&
    o.filtered_figures.every((f) => {
      if (typeof f !== "object" || f === null) return false;
      const item = f as Record<string, unknown>;
      return (
        Number.isInteger(item.index) &&
        typeof item.name === "string" &&
        (item.layer === null || Number.isInteger(item.layer)) &&
        typeof item.reason === "string"
      );
    })
  );
}

function parseOriginFidelity(v: unknown, dsIds: Set<string>): OriginFidelityEntry[] {
  if (!Array.isArray(v)) return [];
  const out: OriginFidelityEntry[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.stem !== "string") continue;
    if (!isOriginFidelityManifest(o.manifest)) continue;
    const siblingIds = stringsIn(o.siblingIds, dsIds);
    if (siblingIds.length === 0) continue;
    out.push({ id: o.id, stem: o.stem, siblingIds, manifest: o.manifest });
  }
  return out;
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
  if (o.version !== 1 && o.version !== 2 && o.version !== 3) {
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
    if (typeof dd.order === "number" && Number.isFinite(dd.order)) ds.order = dd.order;
    return ds;
  });

  // Folder tree (absent in v1 → empty). Prune datasets pointing at a folder that
  // didn't survive validation; clamp active/selection/expansion to live ids.
  const folders = parseFolders(o.folders);
  const datasets = pruneOrphans(folders, datasetsRaw);
  const dsIds = new Set(datasets.map((d) => d.id));
  const folderIds = new Set(folders.map((f) => f.id));
  const selectedIds = stringsIn(o.selectedIds, dsIds);
  const activeId =
    typeof o.activeId === "string" && dsIds.has(o.activeId) ? o.activeId : (datasets[0]?.id ?? null);
  const expandedFolders = stringsIn(o.expandedFolders, folderIds);
  const originFigures = parseOriginFigures(o.originFigures, dsIds);
  const originFidelity = parseOriginFidelity(o.originFidelity, dsIds);
  const smartFolders = sanitizeSmartFolders(o.smartFolders);
  const reports = sanitizeReports(o.reports, dsIds);
  const macroSteps = sanitizeSteps(o.pipeline);
  const recalcMode: RecalcMode =
    o.recalcMode === "manual" || o.recalcMode === "off" ? o.recalcMode : "auto";
  // Legacy Publication Preview FigureDocs stay unchanged until F2 preserves their unsupported overrides.
  const figureDocs = sanitizeFigureDocs(o.figureDocs, dsIds);
  const migrationWarnings: string[] = [];
  const editableFigures = parseEditableFigures(o.editableFigures, dsIds, migrationWarnings);
  const pages = sanitizePageDocuments(o.pages);
  const plotWindows = sanitizeDocumentBackedPlotWindows(o.plotWindows, dsIds, migrationWarnings);
  const focusedWindowId =
    typeof o.focusedWindowId === "string" &&
    plotWindows.some((w) => w.id === o.focusedWindowId && w.kind === "plot")
      ? o.focusedWindowId
      : null;
  const toolWindowLayout = sanitizeToolWindowLayout(o.toolWindowLayout, viewport);
  const savedPlotSpecs = sanitizeSavedPlotSpecs(o.savedPlotSpecs);
  const techniqueViewMemory = sanitizeTechniqueViewMemory(o.techniqueViewMemory);
  return {
    datasets,
    folders,
    activeId,
    selectedIds,
    expandedFolders,
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
  };
}

// Append-a-second-workspace ("Append Project") — `mergeWorkspace` +
// `WorkspaceMergeResult` — lives in ./workspaceMerge.ts (moved out under the
// RSM_CUTS_PLAN item 13 size ratchet: it was already fully self-contained,
// with store/workspaceIO.ts as its only external caller, so extracting it
// funds the upcoming named-ROI hook-in without that caller needing to change).
export * from "./workspaceMerge";
