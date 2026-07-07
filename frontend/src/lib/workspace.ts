// Workspace (.dwk) save/load — serialize the loaded datasets to a portable JSON
// document and parse one back, with validation. A reload otherwise loses the
// library (datasets live only in memory); this gives session persistence. Pure +
// testable; the App wires it to Save/Open commands (download + file picker).

import { sanitizeFilter } from "./datafilter";
import { pruneOrphans } from "./foldertree";
import type { OriginFigureEntry } from "./originFigures";
import { sanitizeSteps, type PipelineStep } from "./pipeline";
import type { RecalcMode } from "./recalc";
import { sanitizeReports, type ReportEntry } from "./report";
import { sanitizeExcluded } from "./rowstate";
import type {
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  Dataset,
  DataStruct,
  FolderNode,
  ModelingType,
} from "./types";

export const WORKSPACE_FORMAT = "quantized-workspace";
// v2 (project-organization plan item 2): adds the folder tree, active/selection,
// and folder-expansion. v3 (gap #5): adds the typed pipeline steps, the recalc
// mode, per-dataset fit specs, and reports. Older docs still load — migrated
// on parse with safe defaults.
export const WORKSPACE_VERSION = 3;

/** The persistable slice of app state (input to serialize). The store's AppState
 *  is a structural superset, so `useApp.getState()` can be passed directly where
 *  this is expected; the extras are optional so a caller with only datasets can
 *  pass `{ datasets }`. */
export interface WorkspaceState {
  datasets: Dataset[];
  folders?: FolderNode[];
  activeId?: string | null;
  selectedIds?: string[];
  expandedFolders?: string[];
  originFigures?: OriginFigureEntry[];
  reports?: ReportEntry[];
  macroSteps?: PipelineStep[];
  recalcMode?: RecalcMode;
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
  reports: ReportEntry[];
  macroSteps: PipelineStep[];
  recalcMode: RecalcMode;
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
  reports: ReportEntry[];
  pipeline: PipelineStep[];
  recalcMode: RecalcMode;
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
    reports: ws.reports ?? [],
    pipeline: ws.macroSteps ?? [],
    recalcMode: ws.recalcMode ?? "auto",
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
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/** Validate a folder-node array (drops malformed entries; reparents a folder to
 *  root if its parent is missing). */
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
      out.push({ id: o.id, name: o.name, parentId: (o.parentId as string | null) ?? null, order: o.order });
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

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
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
 *  v1 docs (datasets only) load with an empty folder tree (migration). */
export function parseWorkspace(text: string): LoadedWorkspace {
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
      ds.fitSpec = { model: (dd.fitSpec as { model: string }).model };
    }
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
  const reports = sanitizeReports(o.reports, dsIds);
  const macroSteps = sanitizeSteps(o.pipeline);
  const recalcMode: RecalcMode =
    o.recalcMode === "manual" || o.recalcMode === "off" ? o.recalcMode : "auto";
  return {
    datasets,
    folders,
    activeId,
    selectedIds,
    expandedFolders,
    originFigures,
    reports,
    macroSteps,
    recalcMode,
  };
}
