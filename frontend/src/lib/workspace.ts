// Workspace (.dwk) save/load — serialize the loaded datasets to a portable JSON
// document and parse one back, with validation. A reload otherwise loses the
// library (datasets live only in memory); this gives session persistence. Pure +
// testable; the App wires it to Save/Open commands (download + file picker).

import { sanitizeFilter } from "./datafilter";
import { pruneOrphans } from "./foldertree";
import type { OriginFidelityEntry } from "./originFidelity";
import type { OriginFigureEntry } from "./originFigures";
import { sanitizeFigureDocs, type FigureDoc } from "./figuredoc";
import { sanitizeSteps, type PipelineStep } from "./pipeline";
import { sanitizePlotWindows, type PlotWindow } from "./plotview";
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
  plotWindows?: PlotWindow[];
  focusedWindowId?: string | null;
  /** GUI_INTERACTION_PLAN #10 item 3 — every floating ToolWindow's persisted
   *  position/size/collapsed, keyed by its `id` prop. */
  toolWindowLayout?: Record<string, ToolWindowLayout>;
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
  plotWindows: PlotWindow[];
  focusedWindowId: string | null;
  toolWindowLayout: Record<string, ToolWindowLayout>;
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
  plotWindows: PlotWindow[];
  focusedWindowId: string | null;
  toolWindowLayout: Record<string, ToolWindowLayout>;
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
    // MULTI_PLOT_PLAN item 7: passed through VERBATIM — the caller (the
    // store's `windowsForSave()`, per the interface doc above) is
    // responsible for the focused window's live-view snapshot; this module
    // stays a plain serializer, same as every other field here.
    plotWindows: ws.plotWindows ?? [],
    focusedWindowId: ws.focusedWindowId ?? null,
    toolWindowLayout: ws.toolWindowLayout ?? {},
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
  const figureDocs = sanitizeFigureDocs(o.figureDocs, dsIds);
  // Plot window layout (MULTI_PLOT_PLAN item 7) — additive-optional, so a
  // pre-item-7 doc (absent field) sanitizes to [] via the same
  // undefined-input path every other sanitizer here already handles.
  const plotWindows = sanitizePlotWindows(o.plotWindows, dsIds);
  // The focus id must land on a kind:"plot" window — a snapshot window
  // (MULTI_PLOT_PLAN item 11) can never hold focus, so a doc pointing at one
  // clamps to null (the store's load path then falls back to the first plot
  // window).
  const focusedWindowId =
    typeof o.focusedWindowId === "string" &&
    plotWindows.some((w) => w.id === o.focusedWindowId && w.kind === "plot")
      ? o.focusedWindowId
      : null;
  // GUI_INTERACTION_PLAN #10 item 3: validated AND clamped to `viewport`
  // right here — a workspace saved on a big monitor must stay reachable on
  // a laptop the moment it's restored, not just lazily whenever a given
  // window is later reopened.
  const toolWindowLayout = sanitizeToolWindowLayout(o.toolWindowLayout, viewport);
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
    plotWindows,
    focusedWindowId,
    toolWindowLayout,
  };
}

// ── Append a second workspace (Origin's "Append Project") ──────────────────
//
// `mergeWorkspace` joins a freshly-PARSED `.dwk` (`LoadedWorkspace`, the
// output of `parseWorkspace` above) into the CURRENTLY loaded library —
// additive, never a replace (that's `loadWorkspace`). Only the flat
// `datasets[]` list is merged in; every workspace-LEVEL structure on the
// incoming doc (folders, originFigures, smartFolders, reports, macroSteps,
// figureDocs, plotWindows, activeId, selectedIds, expandedFolders,
// recalcMode, focusedWindowId) is deliberately never read here — the store
// action built on top of this (`useApp.appendWorkspace`) doesn't touch the
// destination folder tree, view state, or window layout either, so merging
// those in would create structures the store then silently ignores.
//
// The reference-field matrix (every place a .dwk can point at a dataset id,
// and how each is handled by an append):
//   - `Dataset.bgRef.datasetId` — a cross-dataset reference WITHIN the same
//     saved workspace (the background-subtraction picker only ever offers
//     datasets from the workspace being saved, so this always targets
//     another entry in `incoming.datasets`). Remapped through the same id
//     table as the owning datasets; dropped (counted in `droppedBgRefs`) if
//     it targets an id outside the incoming batch — a hand-edited or
//     corrupted .dwk, never a legitimately-saved one.
//   - `Dataset.folderId` — points into `WorkspaceState.folders`, which this
//     merge never imports (see above). Every incoming folder membership is
//     therefore unresolvable by construction; dropped (counted in
//     `droppedFolderRefs`) so the dataset lands at the Library root — the
//     same graceful degrade `foldertree.pruneOrphans` already gives a
//     dataset whose folder didn't survive validation.
//   - `OriginFigureEntry.datasetId`/`.siblingIds`, `ReportEntry.datasetId`,
//     `FigureDoc.datasetId`, `PlotWindow.datasetId`, `WorkspaceState.activeId`/
//     `.selectedIds` — all live in workspace-level structures that are never
//     merged in at all (see above); dropped as whole structures, not
//     field-by-field, alongside the rest of the incoming doc's view state.
//   - `smartFolders`, `macroSteps` (pipeline) — audited and carry NO
//     dataset-id references (a smart folder is a saved TEXT query; a
//     pipeline step replays against "the active dataset" at run time), so
//     there is nothing to reconcile even though they're dropped too.
// Every other per-dataset field (`tags`, `group`, `notes`, `formulas`,
// `channelRoles`, `channelTypes`, `excludedRows`, `filter`, `fitSpec`,
// `order`, `pending`) is self-contained — no id references — and rides
// along untouched onto the merged dataset.

export interface WorkspaceMergeResult {
  /** `current` followed by the incoming datasets, id/name-deduped. Neither
   *  `current` nor any of its existing `Dataset` objects are mutated or
   *  cloned — this array reuses those SAME references. */
  datasets: Dataset[];
  /** Incoming dataset ids that collided with an id already in `current` (or
   *  with another incoming dataset) and were reassigned a fresh id via
   *  `genId`. Ids are never shown to the user — tracked for completeness/
   *  testing, not the append toast. */
  remapped: number;
  /** Incoming dataset NAMES that collided with a name already in `current`
   *  (or with another incoming dataset) and got an Origin-style " (2)"
   *  suffix (`dedupeWindowTitle`'s convention, see lib/plotview.ts). This is
   *  what the append toast reports as "renamed". */
  renamed: number;
  /** `bgRef` back-references dropped because they targeted an id outside
   *  the incoming batch — see the field matrix above. */
  droppedBgRefs: number;
  /** `folderId` memberships dropped because the destination folder tree is
   *  never merged in — see the field matrix above. */
  droppedFolderRefs: number;
}

/** Merge `incoming`'s datasets into `current` (Origin's "Append Project").
 *  Pure: `genId` supplies fresh ids the exact same way `foldertree
 *  .migrateGroupsToFolders`'s `genId` parameter does (the store passes its
 *  `nextDatasetId`), so this stays testable without a store. Two passes —
 *  first assign every incoming dataset a collision-free id (so a `bgRef`
 *  that forward-references a LATER incoming dataset still resolves), then
 *  build the final objects (dedupe the name, remap/drop `bgRef`, drop
 *  `folderId`). See `WorkspaceMergeResult`'s doc for the full reference
 *  matrix this reconciles. */
export function mergeWorkspace(
  current: Dataset[],
  incoming: LoadedWorkspace,
  genId: () => string,
): WorkspaceMergeResult {
  const usedIds = new Set(current.map((d) => d.id));
  const usedNames = new Set(current.map((d) => d.name));

  // Pass 1: a collision-free final id per incoming dataset, BY INDEX (not a
  // Map keyed by the original id — a hand-edited .dwk could carry duplicate
  // ids, and a Map would silently let the last one win for BOTH entries).
  const finalIds: string[] = [];
  // Original id -> final id, for resolving bgRef targets in pass 2 (last
  // write wins on a duplicate original id — the same degrade as above, never
  // a crash).
  const idMap = new Map<string, string>();
  let remapped = 0;
  for (const d of incoming.datasets) {
    let id = d.id;
    if (usedIds.has(id)) {
      do {
        id = genId();
      } while (usedIds.has(id));
      remapped++;
    }
    usedIds.add(id);
    finalIds.push(id);
    idMap.set(d.id, id);
  }

  // Pass 2: dedupe the name, remap/drop bgRef, drop folderId.
  let renamed = 0;
  let droppedBgRefs = 0;
  let droppedFolderRefs = 0;
  const merged = incoming.datasets.map((d, i) => {
    const id = finalIds[i];

    let name = d.name;
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
      renamed++;
    }
    usedNames.add(name);

    const next: Dataset = { ...d, id, name, folderId: undefined };
    if (d.folderId !== undefined) droppedFolderRefs++;
    if (d.bgRef) {
      const target = idMap.get(d.bgRef.datasetId);
      if (target) {
        next.bgRef = { ...d.bgRef, datasetId: target };
      } else {
        next.bgRef = undefined;
        droppedBgRefs++;
      }
    }
    return next;
  });

  return {
    datasets: [...current, ...merged],
    remapped,
    renamed,
    droppedBgRefs,
    droppedFolderRefs,
  };
}
