// Per-dataset parse/validate for a loaded .dwk document — moved out of
// lib/workspace.ts verbatim (mechanical extraction, no behavior change) to
// fund headroom under that file's architecture.test.ts MODULE_PINS entry
// (598/600 before this move — see that pin's history comment). Two upcoming
// features each need a new persisted top-level list field there: `plotRecipes`
// (P1.3) and `savedRecodeMappings` (the deferral documented in
// store/recode.ts's SAVED MAPPINGS note, which names "the next slice that
// earns workspace.ts headroom" as the intended home). This extraction is
// that funding move, not either feature — see the callers for those.
//
// `parseWorkspaceDataset` is the exact body that used to live inline in
// `parseWorkspace`'s `o.datasets.map(...)` callback; `isNumberArray`,
// `isDataStruct`, and `parsePending` are its private helpers. Nothing here
// depends on `parseWorkspace`'s surrounding scope — each dataset entry is
// validated independently from its raw JSON plus its own array index (used
// only for a stable fallback id/name and in error messages).

import { sanitizeDataStruct } from "./categorical";
import { parseDatasetSource } from "./datasetSource";
import { sanitizeFilter } from "./datafilter";
import { sanitizeBindings } from "./errorRoles";
import { applyComputedColumnsExtras } from "./workspaceComputedColumns";
import { sanitizeExcluded } from "./rowstate";
import type {
  BookSource,
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  Dataset,
  DataStruct,
  FitSpec,
  FitWeighting,
  ModelingType,
  WeightMode,
} from "./types";

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

/** Structural check that `v` is a DataStruct (time/values/labels/units/metadata) -- `cat_levels` is repaired separately by `sanitizeDataStruct`, not gated here. */
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

/** Parse + validate one `.dwk` dataset entry (`o.datasets[i]`), throwing a
 *  clear error on anything malformed (not an object, or an invalid
 *  DataStruct) — `parseWorkspace` lets that error propagate to its own
 *  caller unchanged, same as when this was inline there. */
export function parseWorkspaceDataset(d: unknown, i: number): Dataset {
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
    data: sanitizeDataStruct(dd.data),
  };
  if (isDataStruct(dd.raw)) ds.raw = sanitizeDataStruct(dd.raw);
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
  applyComputedColumnsExtras(ds, dd); // PR K (K2/K5b) — lib/workspaceComputedColumns.ts
  // MAIN #33: error roles survive save/reapply, but are re-validated
  // against the CURRENT channel count — a template reapplied to a
  // differently-shaped source must not bind error bars to whatever column
  // now happens to sit at that index.
  const bindings = sanitizeBindings(dd.errorRoles, ds.data.labels.length);
  // O1: preserve a DELIBERATE empty array (raw `errorRoles: []` -- an Origin
  // book whose designations were checked and found to hold zero error
  // columns, lib/originBookRoles.ts) as `[]`, distinct from `undefined` for
  // a genuinely absent field. `sanitizeBindings` returns `[]` for BOTH that
  // case AND a non-empty raw array invalidated down to nothing (e.g. every
  // saved binding now points past the current, changed channel count) --
  // the second case is discarded stale data, not a deliberate "no errors",
  // so it must stay unset exactly like before this change, not get promoted
  // to `[]`. Checking the RAW shape (not just the sanitized result) tells
  // the two apart.
  const rawWasDeliberatelyEmpty = Array.isArray(dd.errorRoles) && dd.errorRoles.length === 0;
  if (bindings !== undefined && (bindings.length > 0 || rawWasDeliberatelyEmpty)) {
    ds.errorRoles = bindings;
  }
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
  const source = parseDatasetSource(dd.source);
  if (source) ds.source = source;
  // P1.7 box 5: see the serializer's matching comment in workspace.ts.
  if (typeof dd.versionOf === "string" && dd.versionOf) ds.versionOf = dd.versionOf;
  if (typeof dd.folderId === "string") ds.folderId = dd.folderId;
  // Raw parse only — reconcileWorkbookRefs (in parseWorkspace, after
  // folders/datasets are pruned) is the single place that decides whether
  // this survives, is repaired, or is replaced; see workspace.ts's
  // WORKSPACE_VERSION v4 comment.
  if (typeof dd.workbookId === "string" && dd.workbookId) ds.workbookId = dd.workbookId;
  if (typeof dd.order === "number" && Number.isFinite(dd.order)) ds.order = dd.order;
  return ds;
}
