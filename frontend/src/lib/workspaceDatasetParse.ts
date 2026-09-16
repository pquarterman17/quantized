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
// `parseWorkspace`'s `o.datasets.map(...)` callback; `isWireDataStruct` and
// `parsePending` are its private helpers (the third, `isNumberArray`, became
// lib/nonFiniteCells' `isWireCellArray` under BUG-017). Nothing here
// depends on `parseWorkspace`'s surrounding scope — each dataset entry is
// validated independently from its raw JSON plus its own array index (used
// only for a stable fallback id/name and in error messages).

import { sanitizeDataStruct } from "./categorical";
import { decodeDataStruct, isWireCellArray, type WireDataStruct } from "./nonFiniteCells";
import { parseDatasetSource } from "./datasetSource";
import { sanitizeFilter } from "./datafilter";
import { sanitizeBindings } from "./errorRoles";
import { baseColumns } from "./formula";
import { sanitizePeakTable } from "./peakTable";
import { applyComputedColumnsExtras } from "./workspaceComputedColumns";
import { sanitizeExcluded } from "./rowstate";
import type {
  BookSource,
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  Dataset,
  FitSpec,
  FitWeighting,
  ModelingType,
  WeightMode,
} from "./types";

// BUG-017: the per-cell check is `isWireCellArray` (lib/nonFiniteCells.ts),
// which accepts a number OR exactly the four sentinel strings `"NaN"`,
// `"Infinity"`, `"-Infinity"` and `"-0"` — the values `JSON.stringify` cannot
// represent, and which `lib/workspaceSerialize.ts` now writes in that form. It
// is deliberately NOT widened to accept `null`: a pre-fix `.dwk` wrote NaN,
// +Infinity and -Infinity all as the SAME `null`, so the original value is not
// recoverable from one, and `null` is equally what genuinely corrupt input
// looks like. Rejecting it keeps that a real rejection rather than a guess
// (the ruling BUG-017's Implementation box asked for).

/** Validate a persisted `Dataset.pending` (#38) — a stale/hand-edited value
 *  degrades to "not pending" (the dataset then just shows whatever rows its
 *  `data` happens to carry) rather than throwing. */
function parsePending(v: unknown): BookSource | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.bookId !== "string" || !o.bookId) return null;
  const rows = typeof o.rows === "number" && Number.isFinite(o.rows) ? o.rows : 0;
  const cols = typeof o.cols === "number" && Number.isFinite(o.cols) ? o.cols : 0;
  // `previewSampled` is carried through ONLY when the file actually states it, and
  // is NOT defaulted here. The fail-closed rule ("unknown means it may be a
  // sample") lives in exactly one place, `lib/rowSidecars.rowsAreSampled`, which
  // treats anything other than an explicit `false` as sampled. Writing a default
  // here too would be a SECOND copy of that rule — which is the mistake the shared
  // predicate exists to prevent, and the one the round-3 review caught between
  // `textColumns.ts` and `store/cellEdit.ts`. It also keeps a legacy `.dwk`
  // round-tripping byte-identically instead of gaining a field it never had.
  const common = {
    bookId: o.bookId,
    rows,
    cols,
    ...(typeof o.previewSampled === "boolean" ? { previewSampled: o.previewSampled } : {}),
  };
  if (o.kind === "path" && typeof o.path === "string" && o.path) {
    return { kind: "path", path: o.path, ...common };
  }
  if (o.kind === "upload" && typeof o.token === "string" && o.token) {
    return { kind: "upload", token: o.token, ...common };
  }
  return null;
}

/** Structural check that `v` is a SERIALIZED DataStruct (time/values/labels/
 *  units/metadata, cells in wire form) -- `cat_levels` is repaired separately
 *  by `sanitizeDataStruct`, not gated here. Callers pair it with
 *  `decodeDataStruct` (BUG-017) to recover the in-memory `DataStruct`. */
function isWireDataStruct(v: unknown): v is WireDataStruct {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isWireCellArray(o.time) &&
    Array.isArray(o.values) &&
    o.values.every((row) => isWireCellArray(row)) &&
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
 *  caller unchanged, same as when this was inline there.
 *
 *  `projectDir` (P1.7 PR 3) is the `.dwk`'s own directory, when the caller
 *  knows one — threaded straight through to `parseDatasetSource` so a
 *  packed project's `kind: "bundle"` sources can resolve; see that
 *  function's doc for what happens when it's absent.
 *
 *  WHY A MALFORMED ENTRY STILL TAKES THE WHOLE WORKSPACE DOWN (BUG-017's
 *  second ruling, decided 2026-09-16). The alternative — skip the bad
 *  dataset and report it through BUG-010's `migrationWarnings` toast — was
 *  considered and REJECTED: a skipped dataset is invisible in the library,
 *  and the user's very next "Save" would write the workspace WITHOUT it,
 *  making a recoverable file permanently lossy. Refusing to open is
 *  recoverable (the file on disk is untouched, and the error names the
 *  dataset); silently dropping a worksheet is not. What BUG-017 changed is
 *  that the ordinary NaN/±Infinity/-0 cells this app itself writes now parse
 *  correctly, so no file WE wrote can reach this throw — it is reserved for
 *  genuinely malformed structure (hand-edited JSON, truncated file, a `null`
 *  cell from a pre-fix save). */
export function parseWorkspaceDataset(d: unknown, i: number, projectDir?: string): Dataset {
  if (typeof d !== "object" || d === null) {
    throw new Error(`dataset ${i} is invalid`);
  }
  const dd = d as Record<string, unknown>;
  if (!isWireDataStruct(dd.data)) {
    throw new Error(`dataset ${i} ("${String(dd.name ?? "")}") has an invalid data structure`);
  }
  const ds: Dataset = {
    id: typeof dd.id === "string" ? dd.id : `ws-${i}`,
    name: typeof dd.name === "string" ? dd.name : `dataset ${i + 1}`,
    data: sanitizeDataStruct(decodeDataStruct(dd.data)),
  };
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
  // SILENT_STATE_CORRUPTION_PLAN #6 version-skew: `ds.formulas` is final as
  // of this point (the block above), so `Dataset.raw`'s always-base-only
  // contract (lib/types.ts's doc) can be enforced here -- a .dwk saved by
  // any build before #6 landed could carry `raw` under the OLD contract
  // (base + whatever computed columns were present at the dataset's FIRST
  // correction apply), which would otherwise make the next apply/reset run
  // `recomputeFromBaseOrEmpty` on an already-wide `raw` and append the
  // formulas a SECOND time (phantom duplicate columns) -- the same
  // corruption class #6 fixed for the live session, now reachable again
  // just by opening an old workspace. Strip the excess trailing columns
  // down to the expected base width when `raw` is too WIDE; a `raw`
  // that's already base-only (the common case) or narrower than expected
  // (nothing to invent) passes through untouched.
  if (isWireDataStruct(dd.raw)) {
    const raw = sanitizeDataStruct(decodeDataStruct(dd.raw));
    const expectedWidth = ds.data.labels.length - (ds.formulas?.length ?? 0);
    ds.raw = raw.labels.length > expectedWidth ? baseColumns(raw, raw.labels.length - expectedWidth) : raw;
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
  // Durable fitted-peak table (audit P2.1). Additive-optional exactly like
  // `fitSpec` above: absent (every pre-P2.1 `.dwk`) means the dataset simply
  // has no peak table, and a malformed record degrades to that same "none"
  // rather than throwing — `sanitizePeakTable` owns every rule.
  const peakTable = sanitizePeakTable(dd.peakTable);
  if (peakTable) ds.peakTable = peakTable;
  // Lazy per-book reference (#38) — only ever present in an autosave
  // snapshot (a real "Save workspace" export always resolves it first);
  // validated the same defensive way as every other optional field here.
  const pending = parsePending(dd.pending);
  if (pending) ds.pending = pending;
  const source = parseDatasetSource(dd.source, projectDir);
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
