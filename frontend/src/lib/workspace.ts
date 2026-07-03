// Workspace (.dwk) save/load — serialize the loaded datasets to a portable JSON
// document and parse one back, with validation. A reload otherwise loses the
// library (datasets live only in memory); this gives session persistence. Pure +
// testable; the App wires it to Save/Open commands (download + file picker).

import { sanitizeExcluded } from "./rowstate";
import type {
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  Dataset,
  DataStruct,
  ModelingType,
} from "./types";

export const WORKSPACE_FORMAT = "quantized-workspace";
export const WORKSPACE_VERSION = 1;

interface WorkspaceDoc {
  format: string;
  version: number;
  savedAt: string;
  datasets: Dataset[];
}

/** Serialize the library to a pretty-printed .dwk JSON document. */
export function serializeWorkspace(datasets: Dataset[]): string {
  const doc: WorkspaceDoc = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    datasets: datasets.map((d) => ({
      id: d.id,
      name: d.name,
      data: d.data,
      ...(d.raw ? { raw: d.raw } : {}),
      ...(d.corrections ? { corrections: d.corrections } : {}),
      ...(d.bgRef ? { bgRef: d.bgRef } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
      ...(d.tags?.length ? { tags: d.tags } : {}),
      ...(d.group?.trim() ? { group: d.group } : {}),
      ...(d.formulas?.length ? { formulas: d.formulas } : {}),
      ...(d.channelRoles && Object.keys(d.channelRoles).length
        ? { channelRoles: d.channelRoles }
        : {}),
      ...(d.channelTypes && Object.keys(d.channelTypes).length
        ? { channelTypes: d.channelTypes }
        : {}),
      ...(d.excludedRows?.length ? { excludedRows: d.excludedRows } : {}),
    })),
  };
  return JSON.stringify(doc, null, 2);
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

/** Parse a .dwk document back into datasets, throwing a clear error on anything
 *  malformed (bad JSON, wrong format/version, or an invalid DataStruct). */
export function parseWorkspace(text: string): Dataset[] {
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
  if (o.version !== WORKSPACE_VERSION) {
    throw new Error(`unsupported workspace version: ${String(o.version)}`);
  }
  if (!Array.isArray(o.datasets)) {
    throw new Error("workspace has no datasets");
  }
  return o.datasets.map((d, i): Dataset => {
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
    return ds;
  });
}
