// Cross-instance workbook transfer — versioned, bounded package format (PR I,
// LIBRARY_WORKBOOK_UX_PLAN L0.23/L0.24, "Cross-session workbook transfer
// requirements"). Pure: build a self-describing package from a live
// workbook, validate one read back, and rewrite every internal id fresh on
// paste. Clipboard I/O and the store orchestration live in
// store/workbookTransfer.ts — this module never touches `navigator
// .clipboard` or a Zustand store, so the fresh-id-rewrite core (the part
// that most needs to be right) is unit-testable with plain objects, the same
// "pure planning, thin store orchestrator" split lib/workbookCombine.ts and
// lib/relink.ts already use.
//
// PAYLOAD (L0.24): the workbook itself, every worksheet (Dataset) that is a
// member, every editable figure (FigureDocument) and analysis/derived result
// (ReportEntry) whose sole `datasetId` is one of those worksheets — both are
// single-`datasetId`-only (LIBRARY_WORKBOOK_UX_PLAN PR J slice-1's own
// finding: "FigureDocument/FigureDoc/ReportEntry are all
// single-datasetId-only"), so a workbook-local payload can decide inclusion
// by plain membership, with no multi-workbook figure ever needing a
// split/partial-transfer rule here — and every Quick Plot template SCOPED to
// this workbook (`scope.kind === "workbook"`). Per-worksheet notes,
// metadata, tags, formulas, and provenance ride along on the `Dataset`
// object untouched — no separate section needed for those.
//
// Deliberately NOT carried (a documented scope choice, not a silent gap):
// legacy `FigureDoc` (the superseded Publication Preview model —
// `editableFigures` is the canonical figure type L0.24 names, and
// figureLifecycle.ts's own header already calls FigureDoc "legacy"), a
// dataset's `folderId` (the destination folder tree is a different project's
// structure — the same "never merged in" ruling lib/workspaceMerge.ts's
// append uses, for the identical reason: pointing at a folder id that may
// not even exist on the other side would be worse than landing at a clear
// root/target), multi-panel `PageDocument`s (can span several workbooks by
// design — no single-workbook home to travel to), and `originFigures`/
// `originFidelity` (Origin-import fidelity metadata keyed to the ORIGINAL
// project's own book layout, not portable across a fresh-id rewrite). A
// later slice can widen this list; narrowing what already shipped never
// happens silently.
//
// VALIDATION REUSE: rather than hand-writing a second per-field Dataset/
// FigureDocument/ReportEntry/QuickPlotTemplate sanitizer, `parseTransferPackage`
// wraps the incoming arrays in a synthetic single-workbook `.dwk` document and
// hands it to `lib/workspace.ts`'s own `parseWorkspace` — the SAME "drop
// malformed, never throw" sanitizers a real project open already runs
// (DataStruct shape, corrections, bgRef, formulas, error-role bindings,
// FigureDocument version-skip, dsId-scoped report/template filtering all come
// for free), instead of a parallel copy that could silently drift out of sync
// with what a `.dwk` actually accepts. Only the transfer-package ENVELOPE
// (`format`/`version`) is new validation.
//
// FRESH-ID REWRITE (frozen-scope item 3): `pasteTransferPackage` below is the
// core requirement 3/6 both build on ("paste" and "duplicate" are the SAME
// operation with a different id-existence snapshot and a different target
// folder). EVERY id in the pasted set is reassigned, UNCONDITIONALLY — not
// only on collision. This is the one deliberate divergence from
// lib/workspaceMerge.ts's append policy (which only reassigns a dataset id
// on an actual collision): append is a same-app, same-session operation
// where a colliding id is the only real aliasing risk; paste is explicitly
// CROSS-PROCESS (frozen-scope item 2), so an incoming id that happens not to
// collide with THIS destination today could still be the very id its own
// source project keeps using in its own undo history / recalc graph after
// the copy — "a pasted workbook must never alias or depend on the source
// project" (item 3) reads as an unconditional rule, and the id assignment
// here honors it unconditionally rather than only defensively.
//
// EDGE ENUMERATION (every place a package's internal payload can reference
// another id inside itself — the completeness argument the id-rewrite must
// satisfy):
//   - Dataset.id                         — rewritten (fresh, always)
//   - Dataset.workbookId                 — rewritten to the new workbook id
//   - Dataset.folderId                   — dropped (see "deliberately NOT
//     carried" above); replaced by the caller's `targetFolderId`
//   - Dataset.bgRef.datasetId            — rewritten if the target is inside
//     the pasted set, else the whole `bgRef` is dropped (never left pointing
//     at a source-project id)
//   - Dataset.derivedFrom.datasetId      — same rule as bgRef
//   - Dataset.versionOf                  — same rule as bgRef
//   - WorkbookNode.id                    — rewritten (fresh, always)
//   - WorkbookNode.folderId              — dropped; replaced by
//     `targetFolderId` (same "destination decides placement" rule as above)
//   - WorkbookNode.order                 — dropped (undefined sinks the
//     pasted workbook after any keyed sibling, `lib/order.ts`'s `byOrder` —
//     matches workspaceMerge's transferred-workbook convention)
//   - FigureDocument.id                  — rewritten (fresh, always)
//   - FigureDocument.bindings.datasetId  — rewritten through the SAME
//     dataset id map (a figure was only included in the package because its
//     datasetId was a member — see PAYLOAD above — so this always resolves;
//     the `null` "unbound figure" case passes through as `null`)
//   - ReportEntry.id                     — rewritten (fresh, always)
//   - ReportEntry.datasetId              — same rule as FigureDocument's
//   - QuickPlotTemplate.id               — rewritten (fresh, always)
//   - QuickPlotTemplate.scope.workbookId — rewritten to the new workbook id
//     (a template was only included because its scope named THIS workbook —
//     see PAYLOAD above — so it always exists and is always workbook-scoped)
// Every id above is EITHER freshly minted (workbook/dataset/figure/report/
// template ids) or resolved through a same-paste id map built from those
// fresh assignments — there is no third path an id can take, which is what
// makes "zero collision with the destination, every internal edge lands
// inside the pasted set" a provable invariant rather than an empirical one:
// see workbookTransfer.test.ts's collision + edge-closure assertions.

import type { FigureDocument } from "./figureDocument";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import type { ReportEntry } from "./report";
import type { Dataset } from "./types";
import { parseWorkspace, WORKSPACE_FORMAT, WORKSPACE_VERSION } from "./workspace";
import type { WorkbookNode } from "./workbooks";

export const WORKBOOK_TRANSFER_FORMAT = "quantized-workbook-transfer";
export const WORKBOOK_TRANSFER_VERSION = 1;

/** SIZE BOUND (frozen-scope item 1), checked AFTER serializing (the true
 *  cost — an estimate over nested arrays could under/over-count). 8,000,000
 *  UTF-16 code units: the clipboard-text transport this slice ships (see
 *  store/workbookTransfer.ts's module doc for the full transport ruling) is
 *  the binding constraint, not disk. `navigator.clipboard.writeText` has no
 *  documented hard cap, but a very large string risks browser-specific
 *  slowdown or failure with no good error surface to report through, so this
 *  refuses cleanly, in advance, with the actual size named — rather than
 *  attempting a multi-MB clipboard write and finding out. */
export const MAX_TRANSFER_PACKAGE_CHARS = 8_000_000;

export interface WorkbookTransferPackage {
  format: typeof WORKBOOK_TRANSFER_FORMAT;
  version: number;
  createdAt: string;
  workbook: WorkbookNode;
  datasets: Dataset[];
  editableFigures: FigureDocument[];
  reports: ReportEntry[];
  quickPlotTemplates: QuickPlotTemplate[];
}

/** The slice of app state `buildTransferPackage` reads from — a structural
 *  subset of `AppState`, so `useApp.getState()` can be passed directly. */
export interface TransferSourceState {
  workbooks: readonly WorkbookNode[];
  datasets: readonly Dataset[];
  editableFigures: readonly FigureDocument[];
  reports: readonly ReportEntry[];
  quickPlotTemplates: readonly QuickPlotTemplate[];
}

export type BuildTransferResult =
  | { ok: true; pkg: WorkbookTransferPackage; text: string }
  | { ok: false; reason: string };

function mb(chars: number): string {
  return `${(chars / 1_000_000).toFixed(1)} MB`;
}

/** Build a self-contained package for `workbookId` from `state`. Refuses
 *  (BOUNDED, frozen-scope item 1) with a clear reason naming the size when
 *  the serialized package exceeds `MAX_TRANSFER_PACKAGE_CHARS`, and refuses
 *  when the workbook has a not-yet-loaded (`pending`) worksheet — the same
 *  "resolve lazy books first" precondition `store/workspaceIO.ts`'s
 *  `serializeCurrentWorkspace` enforces before a `.dwk` save; the caller
 *  (store/workbookTransfer.ts) resolves pending datasets before calling this
 *  so the ordinary path never hits this refusal. */
export function buildTransferPackage(workbookId: string, state: TransferSourceState): BuildTransferResult {
  const workbook = state.workbooks.find((w) => w.id === workbookId);
  if (!workbook) return { ok: false, reason: "workbook not found" };
  const datasets = state.datasets.filter((d) => d.workbookId === workbookId);
  if (datasets.length === 0) return { ok: false, reason: "workbook has no worksheets to copy" };
  const pending = datasets.filter((d) => d.pending);
  if (pending.length > 0) {
    return {
      ok: false,
      reason: `${pending.length} worksheet${pending.length === 1 ? "" : "s"} not fully loaded yet — try again in a moment`,
    };
  }
  const memberIds = new Set(datasets.map((d) => d.id));
  const editableFigures = state.editableFigures.filter(
    (f) => f.bindings.datasetId !== null && memberIds.has(f.bindings.datasetId),
  );
  const reports = state.reports.filter((r) => r.datasetId !== null && memberIds.has(r.datasetId));
  const quickPlotTemplates = state.quickPlotTemplates.filter(
    (t) => t.scope.kind === "workbook" && t.scope.workbookId === workbookId,
  );
  const pkg: WorkbookTransferPackage = {
    format: WORKBOOK_TRANSFER_FORMAT,
    version: WORKBOOK_TRANSFER_VERSION,
    createdAt: new Date().toISOString(),
    workbook,
    datasets,
    editableFigures,
    reports,
    quickPlotTemplates,
  };
  const text = JSON.stringify(pkg);
  if (text.length > MAX_TRANSFER_PACKAGE_CHARS) {
    return {
      ok: false,
      reason: `workbook is too large to transfer (${mb(text.length)}, limit ${mb(MAX_TRANSFER_PACKAGE_CHARS)})`,
    };
  }
  return { ok: true, pkg, text };
}

export type ParseTransferResult =
  | { ok: true; pkg: WorkbookTransferPackage }
  | { ok: false; reason: string };

/** Validate + sanitize a package read back from clipboard/file text. Never
 *  throws — every failure (bad JSON, wrong format/version, oversize, an
 *  unresolvable structure) reports a human `reason` string instead, so the
 *  caller can leave the destination untouched and say why (frozen-scope item
 *  5's "leave the destination byte-identical" starts here: nothing this
 *  function returns is ever partially applied). */
export function parseTransferPackage(text: string): ParseTransferResult {
  if (text.length > MAX_TRANSFER_PACKAGE_CHARS) {
    return { ok: false, reason: `transfer package too large (${mb(text.length)}, limit ${mb(MAX_TRANSFER_PACKAGE_CHARS)})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "clipboard does not contain a workbook package" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "clipboard does not contain a workbook package" };
  }
  const o = parsed as Record<string, unknown>;
  if (o.format !== WORKBOOK_TRANSFER_FORMAT) {
    return { ok: false, reason: "clipboard does not contain a Quantized workbook" };
  }
  if (o.version !== WORKBOOK_TRANSFER_VERSION) {
    return { ok: false, reason: `unsupported workbook transfer version: ${String(o.version)}` };
  }
  if (typeof o.workbook !== "object" || o.workbook === null || typeof (o.workbook as { id?: unknown }).id !== "string") {
    return { ok: false, reason: "workbook package is missing its workbook" };
  }
  const workbookId = (o.workbook as { id: string }).id;

  // Reuse lib/workspace.ts's own sanitizers wholesale (see module doc) by
  // wrapping the incoming arrays in a synthetic single-workbook `.dwk`
  // document. `parseWorkspace` throws on a structurally-broken document
  // (e.g. a dataset with an invalid DataStruct) — caught here and turned
  // into the same honest `reason` string every other failure above uses.
  const synthetic = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    datasets: Array.isArray(o.datasets) ? o.datasets : [],
    workbooks: [o.workbook],
    editableFigures: Array.isArray(o.editableFigures) ? o.editableFigures : [],
    reports: Array.isArray(o.reports) ? o.reports : [],
    quickPlotTemplates: Array.isArray(o.quickPlotTemplates) ? o.quickPlotTemplates : [],
  };
  let loaded: ReturnType<typeof parseWorkspace>;
  try {
    loaded = parseWorkspace(JSON.stringify(synthetic));
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "workbook package is invalid" };
  }
  const workbook = loaded.workbooks.find((w) => w.id === workbookId);
  if (!workbook || loaded.datasets.length === 0) {
    return { ok: false, reason: "workbook package carries no worksheets" };
  }
  const memberIds = new Set(loaded.datasets.filter((d) => d.workbookId === workbookId).map((d) => d.id));
  return {
    ok: true,
    pkg: {
      format: WORKBOOK_TRANSFER_FORMAT,
      version: WORKBOOK_TRANSFER_VERSION,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
      workbook,
      datasets: loaded.datasets.filter((d) => memberIds.has(d.id)),
      editableFigures: loaded.editableFigures.filter((f) => f.bindings.datasetId && memberIds.has(f.bindings.datasetId)),
      reports: loaded.reports.filter((r) => r.datasetId && memberIds.has(r.datasetId)),
      quickPlotTemplates: loaded.quickPlotTemplates.filter(
        (t) => t.scope.kind === "workbook" && t.scope.workbookId === workbookId,
      ),
    },
  };
}

export interface TransferIdGenerators {
  dataset: () => string;
  workbook: () => string;
  figure: () => string;
  report: () => string;
  template: () => string;
}

/** The destination's current id/name universe, so every fresh id this module
 *  mints is provably collision-free against it (frozen-scope item 3's "zero
 *  id collision with the destination" test). */
export interface TransferExistingIds {
  datasetIds: ReadonlySet<string>;
  datasetNames: ReadonlySet<string>;
  workbookIds: ReadonlySet<string>;
  figureIds: ReadonlySet<string>;
  reportIds: ReadonlySet<string>;
  templateIds: ReadonlySet<string>;
}

export interface PasteResult {
  workbook: WorkbookNode;
  datasets: Dataset[];
  editableFigures: FigureDocument[];
  reports: ReportEntry[];
  quickPlotTemplates: QuickPlotTemplate[];
  /** `bgRef`/`derivedFrom`/`versionOf` links that named an id OUTSIDE the
   *  pasted set and were dropped rather than aliased — always 0 for a
   *  package `buildTransferPackage` produced (every internal ref in a
   *  correctly-built package targets another member of the same workbook);
   *  only a hand-edited/corrupted package can make this positive, and even
   *  then the paste still succeeds with everything else intact. */
  droppedExternalRefs: number;
}

function freshId(gen: () => string, used: Set<string>): string {
  let id = gen();
  while (used.has(id)) id = gen();
  used.add(id);
  return id;
}

/** THE fresh-id rewrite core (frozen-scope items 3 and 6 — Paste and
 *  Duplicate call this identically, differing only in which `existing` id
 *  snapshot and `targetFolderId` they pass). Pure: never mutates `pkg`, never
 *  touches a store. See this module's header for the full edge enumeration
 *  this function closes over. */
export function pasteTransferPackage(
  pkg: WorkbookTransferPackage,
  existing: TransferExistingIds,
  gen: TransferIdGenerators,
  targetFolderId: string | undefined,
): PasteResult {
  const usedWorkbookIds = new Set(existing.workbookIds);
  const workbookId = freshId(gen.workbook, usedWorkbookIds);

  const usedDatasetIds = new Set(existing.datasetIds);
  const usedNames = new Set(existing.datasetNames);
  const datasetIdMap = new Map<string, string>();
  for (const d of pkg.datasets) datasetIdMap.set(d.id, freshId(gen.dataset, usedDatasetIds));

  let droppedExternalRefs = 0;
  const rewriteRef = (targetId: string | undefined): string | undefined => {
    if (targetId === undefined) return undefined;
    const mapped = datasetIdMap.get(targetId);
    if (mapped === undefined) droppedExternalRefs++;
    return mapped;
  };

  const datasets: Dataset[] = pkg.datasets.map((d) => {
    const id = datasetIdMap.get(d.id)!;
    let name = d.name;
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
    }
    usedNames.add(name);
    const next: Dataset = { ...d, id, name, workbookId, folderId: targetFolderId };
    const bgTarget = rewriteRef(d.bgRef?.datasetId);
    next.bgRef = d.bgRef && bgTarget ? { ...d.bgRef, datasetId: bgTarget } : undefined;
    const derivedTarget = rewriteRef(d.derivedFrom?.datasetId);
    next.derivedFrom = d.derivedFrom && derivedTarget ? { ...d.derivedFrom, datasetId: derivedTarget } : undefined;
    next.versionOf = rewriteRef(d.versionOf);
    return next;
  });

  const workbook: WorkbookNode = { ...pkg.workbook, id: workbookId, folderId: targetFolderId, order: undefined };

  const usedFigureIds = new Set(existing.figureIds);
  const editableFigures: FigureDocument[] = pkg.editableFigures.map((f) => ({
    ...f,
    id: freshId(gen.figure, usedFigureIds),
    bindings: {
      ...f.bindings,
      datasetId: f.bindings.datasetId ? (datasetIdMap.get(f.bindings.datasetId) ?? null) : null,
    },
  }));

  const usedReportIds = new Set(existing.reportIds);
  const reports: ReportEntry[] = pkg.reports.map((r) => ({
    ...r,
    id: freshId(gen.report, usedReportIds),
    datasetId: r.datasetId ? (datasetIdMap.get(r.datasetId) ?? null) : null,
  }));

  const usedTemplateIds = new Set(existing.templateIds);
  const quickPlotTemplates: QuickPlotTemplate[] = pkg.quickPlotTemplates.map((t) => ({
    ...t,
    id: freshId(gen.template, usedTemplateIds),
    scope: { kind: "workbook", workbookId },
  }));

  return { workbook, datasets, editableFigures, reports, quickPlotTemplates, droppedExternalRefs };
}
