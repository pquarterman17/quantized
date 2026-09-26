// The .dwk WRITE side: the on-disk document shape (`WorkspaceDoc`) and
// `serializeWorkspace`. Extracted verbatim from `./workspace.ts` for the same
// reason and in the same shape as `./workspaceMerge.ts` before it — that file
// is the READ side (`parseWorkspace` + the sanitizers it drives) and was at
// its size pin, so the recipe-source fidelity signal had to be funded by an
// extraction rather than a bigger number.
//
// `workspace.ts` re-exports this, so every existing importer of
// `serializeWorkspace` is untouched. `WorkspaceDoc` stays module-private: it
// had exactly one consumer, the serializer below, and keeping it here is what
// makes "a new persisted field means a WorkspaceState field + a WorkspaceDoc
// field + a serializer default + a parseWorkspace sanitize step" (see
// `store/recode.ts`'s note) a two-file change instead of a scattered one.

import type { FigureDoc } from "./figuredoc";
import type { FigureDocument } from "./figureDocument";
import type { PageDocument } from "./pageDocument";
import type { PipelineStep } from "./pipeline";
import type { SavedPlotSpec } from "./plotspec";
import { serializePeakTable } from "./peakTable";
import type { PlotRecipe } from "./plotRecipe";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import type { RoiDef } from "./roi";
import type { LibrarySelection } from "../store/libraryPanel";
import { serializeRois } from "../store/rois";
import { isDefaultMapViews, serializeMapViews, type MapViewMap } from "./mapView";
import type { TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { RecalcMode } from "./recalc";
import type { ReportEntry } from "./report";
import type { SmartFolder } from "./smartfolders";
import type { Collection } from "./collections";
import type { LibraryDetailsColumnKey } from "./libraryDetailsColumns";
import type { ToolWindowLayout } from "./toolwindow";
import { serializeComputedColumnsExtras } from "./workspaceComputedColumns";
import type { WorkbookNode } from "./workbooks";
import type { OriginFidelityEntry } from "./originFidelity";
import type { OriginFigureEntry } from "./originFigures";
import { deriveBundleRelativePath } from "./bundlePath";
import { encodePersistedCells, type WireDataStruct } from "./nonFiniteCells";
import type { DatasetSource } from "./datasetSource";
import type { Dataset, FolderNode } from "./types";
import { WORKSPACE_FORMAT, WORKSPACE_VERSION, WORKSPACE_VERSION_TRANSFORM_STEPS, type WorkspaceState } from "./workspace";
import type { PlotWindow } from "./plotview";

/** A persisted dataset source entry — `kind: "path"` (today's shape,
 *  unchanged) or the P1.7 PR 3 `kind: "bundle"` extension (see
 *  `serializeDatasetSource`'s doc for when each is written). */
type SerializedSource =
  | { kind: "path"; path: string; checksum?: string; mtime?: number; size?: number; packedFrom?: string }
  | { kind: "bundle"; path: string; checksum?: string; mtime?: number; size?: number; packedFrom?: string };

/** Write a dataset's (or a workbook's — see the call sites below, PR 3
 *  review finding #4) `source` — `kind: "bundle"` (bundle-relative,
 *  portable) when `projectDir` is given AND `source.path` sits directly
 *  under `<projectDir>/sources/`; `kind: "path"` (absolute, today's shape)
 *  otherwise. This is what makes a packed project saved BACK to its own
 *  folder stay portable, while the same project "Saved As" into a
 *  different folder (or opened with no known directory at all, e.g. after
 *  an autosave recovery) is written with plain absolute paths to the
 *  bundle copies — still perfectly valid, just no longer relocatable as a
 *  unit.
 *
 *  PR 3 review finding #1/#2 (design change): the bundle-relative form is
 *  derived FRESH from the live `source.path` at every save
 *  (`lib/bundlePath.ts`'s `deriveBundleRelativePath`, an exact,
 *  case-sensitive `<projectDir>/sources/` prefix compare) rather than
 *  recalled from a parse-time `bundlePath` field and cross-checked by a
 *  case-folding path-identity comparison — that old comparison would treat
 *  `/data/Proj` and `/data/proj` as the same directory on a case-sensitive
 *  volume and write a bundle reference to a file that does not exist
 *  there. Deriving fresh means a relink or manual edit that moved
 *  `source.path` since load is automatically reflected (a path no longer
 *  under `<projectDir>/sources/` simply stops qualifying) with no separate
 *  field to go stale. */
function serializeDatasetSource(source: DatasetSource, projectDir: string | undefined): SerializedSource {
  const provenance = {
    ...(source.checksum ? { checksum: source.checksum } : {}),
    ...(source.mtime !== undefined ? { mtime: source.mtime } : {}),
    ...(source.size !== undefined ? { size: source.size } : {}),
    ...(source.packedFrom ? { packedFrom: source.packedFrom } : {}),
  };
  if (projectDir !== undefined) {
    const rel = deriveBundleRelativePath(projectDir, source.path);
    if (rel !== null) {
      return { kind: "bundle", path: rel, ...provenance };
    }
  }
  return { kind: "path", path: source.path, ...provenance };
}

/** A serialized dataset entry — `Dataset` with its `source` field widened to
 *  `SerializedSource` (the on-disk `kind: "path"` | `kind: "bundle"` union,
 *  P1.7 PR 3) in place of the in-memory-only `DatasetSource`, and its two
 *  DataStruct-valued fields widened to `WireDataStruct` (BUG-017 — a cell
 *  JSON cannot represent is written as a sentinel string; see
 *  lib/nonFiniteCells.ts for the encoding and why it costs an ordinary
 *  document nothing). */
type SerializedDataset = Omit<Dataset, "source" | "data" | "raw"> & {
  source?: SerializedSource;
  data: WireDataStruct;
  raw?: WireDataStruct;
};

/** A serialized workbook entry — `WorkbookNode` with its `source` field
 *  (PR 3 review finding #4) widened the same way `SerializedDataset` widens
 *  `Dataset.source`, so a workbook's import provenance gets the SAME
 *  `kind: "bundle"` treatment as its member datasets' sources rather than
 *  being written verbatim (which would leak an absolute path even for a
 *  packed project saved back into its own bundle). */
type SerializedWorkbookNode = Omit<WorkbookNode, "source"> & { source?: SerializedSource };

interface WorkspaceDoc {
  format: string;
  version: number;
  savedAt: string;
  datasets: SerializedDataset[];
  folders: FolderNode[];
  workbooks: SerializedWorkbookNode[];
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
  /** Audit P2.8 — additive-OPTIONAL, and written only when at least one
   *  dataset's map view is non-default (see the serializer below). */
  mapViews?: MapViewMap;
  quickPlotTemplates: QuickPlotTemplate[];
  librarySelection: LibrarySelection | null;
  workbookLastChild: Record<string, string>;
  expandedWorkbookIds: string[];
  collections: Collection[];
  visibleDetailsColumns: LibraryDetailsColumnKey[];
  plotRecipes: PlotRecipe[];
}

/** Serialize the library + folder tree to a pretty-printed .dwk JSON
 *  document.
 *
 *  `opts.projectDir` (P1.7 PR 3): the directory this `.dwk` is ABOUT to be
 *  written into (or is already saved in, for a quick save) — passed only by
 *  a caller that actually knows one (`store/workspaceIO.ts`'s
 *  `runSaveWorkspace`/`runSaveWorkspaceToFile`), never by autosave or a
 *  browser download, which have no durable directory to reason about. See
 *  `serializeDatasetSource` for the per-source rule this enables. */
export function serializeWorkspace(ws: WorkspaceState, opts?: { projectDir?: string }): string {
  const projectDir = opts?.projectDir;
  const doc: WorkspaceDoc = {
    format: WORKSPACE_FORMAT,
    // v5 only when a `transform` step is present — see WORKSPACE_VERSION_TRANSFORM_STEPS.
    version: (ws.macroSteps ?? []).some((st) => st.kind === "transform") ? WORKSPACE_VERSION_TRANSFORM_STEPS : WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    folders: ws.folders ?? [],
    // PR 3 review finding #4: a workbook's `source` (import provenance) is
    // routed through the SAME `serializeDatasetSource` helper a dataset's
    // `source` uses — see `SerializedWorkbookNode`'s doc above — rather than
    // written verbatim, which used to leak an absolute path even when the
    // project itself is portable.
    workbooks: (ws.workbooks ?? []).map((w) =>
      w.source ? { ...w, source: serializeDatasetSource(w.source, projectDir) } : w,
    ),
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
    // The caller (`windowsForSave()`) still owns the focused window's
    // save-time-fresh view. The JSON boundary below preserves numeric
    // identities in frozen documents and snapshot bundles without mutating
    // these live objects.
    plotWindows: ws.plotWindows ?? [],
    focusedWindowId: ws.focusedWindowId ?? null,
    toolWindowLayout: ws.toolWindowLayout ?? {},
    savedPlotSpecs: ws.savedPlotSpecs ?? [],
    quickPlotTemplates: ws.quickPlotTemplates ?? [], // PR H — verbatim, same convention as savedPlotSpecs
    // PLOT_WORKFLOW_PLAN item 5: passed through verbatim, same convention as
    // `plotWindows` above — the caller (windowsForSave()'s save-time-freshen
    // sibling, `captureTechniqueView` applied to the live view) owns the fold.
    techniqueViewMemory: ws.techniqueViewMemory ?? {},
    // RSM_CUTS_PLAN item 13: named ROIs only (see WorkspaceState's doc) — the
    // actual (de)serialize logic lives in store/rois.ts, this module just calls it.
    savedRois: serializeRois(ws.savedRois ?? []),
    // Audit P2.8: the per-dataset durable map views, written ONLY when some
    // dataset's view actually records a decision. BUG-017's rule for an
    // additive field — a project that never opened a map serializes
    // byte-for-byte as it did before this field existed, so no schema bump and
    // no diff on an untouched document. OPENING a map is a pure lookup and
    // writes no entry, so it cannot grow the document either. The copy goes
    // through lib/mapView's own serializer for the same reason `savedRois`
    // goes through `serializeRois`: a live store object must never be aliased
    // into the saved doc.
    ...(ws.mapViews && !isDefaultMapViews(ws.mapViews) ? { mapViews: serializeMapViews(ws.mapViews) } : {}),
    // PR E2: passed through verbatim, same plain-serializer convention as
    // every other field here.
    librarySelection: ws.librarySelection ?? null,
    workbookLastChild: ws.workbookLastChild ?? {},
    expandedWorkbookIds: ws.expandedWorkbookIds ?? [],
    collections: ws.collections ?? [],
    visibleDetailsColumns: ws.visibleDetailsColumns ?? [], // PR L slice 2 — verbatim; sanitizeVisibleDetailsColumns defaults on PARSE
    plotRecipes: ws.plotRecipes ?? [], // P1.3 — verbatim, same convention as savedPlotSpecs/quickPlotTemplates
    datasets: ws.datasets.map((d) => ({
      id: d.id,
      name: d.name,
      // BUG-017/BUG-023: the shared replacer at the JSON boundary below
      // sentinel-encodes the four numeric identities JSON cannot preserve.
      // These live objects are never rewritten, and finite output is exact.
      data: d.data,
      // The object-valued optional fields below are written as PLAIN
      // properties, not `...(d.x ? { x: d.x } : {})` spreads: JSON.stringify
      // drops an `undefined` property exactly as the spread omitted it, so the
      // document is byte-identical, and each spread cost ~18 eager bytes the
      // bundle budget did not have (P2.2 slice 3 funded `reflFits` with them).
      // Only object values qualify — a falsy-but-present value ("" / 0) would
      // be written where the spread skipped it; for these fields that value
      // can only be `null`, which no writer produces (and the parser rejects).
      raw: d.raw,
      corrections: d.corrections,
      bgRef: d.bgRef,
      ...(d.notes ? { notes: d.notes } : {}),
      ...(d.tags?.length ? { tags: d.tags } : {}),
      ...(d.group?.trim() ? { group: d.group } : {}),
      ...(d.folderId ? { folderId: d.folderId } : {}),
      ...(d.workbookId ? { workbookId: d.workbookId } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.formulas?.length ? { formulas: d.formulas } : {}),
      ...serializeComputedColumnsExtras(d),
      ...(d.errorRoles !== undefined ? { errorRoles: d.errorRoles } : {}), // O1 exception: `[]` is meaningful -- lib/originBookRoles.ts
      ...(d.importedAt ? { importedAt: d.importedAt } : {}),
      ...(d.channelRoles && Object.keys(d.channelRoles).length ? { channelRoles: d.channelRoles } : {}),
      ...(d.channelTypes && Object.keys(d.channelTypes).length ? { channelTypes: d.channelTypes } : {}),
      ...(d.excludedRows?.length ? { excludedRows: d.excludedRows } : {}),
      ...(d.filter?.length ? { filter: d.filter } : {}),
      fitSpec: d.fitSpec,
      // Audit P2.1: the durable fitted-peak table, additive-optional (absent =
      // no table, so a pre-P2.1 doc round-trips byte-identically). Copied
      // through lib/peakTable's own serializer for the same reason `savedRois`
      // goes through `serializeRois` — a live store object must never be
      // aliased into the saved doc.
      ...(d.peakTable ? { peakTable: serializePeakTable(d.peakTable) } : {}),
      // P2.2 slice 3: the reflectivity fit history, verbatim (absent when
      // undefined, like the plain properties above). The workshop stores each
      // record already JSON-safe (non-finite numbers as the BUG-017 sentinels)
      // and validates it on READ, so this eager path only passes it through —
      // see workshops/reflectivity/reflFitRecord.ts.
      reflFits: d.reflFits,
      // ORIGIN_FILE_DECODE_PLAN #38: EVERY explicit export path resolves
      // every pending dataset FIRST, and aborts with a named status/toast
      // if a book can't be fetched rather than exporting the preview —
      // Save and Save As (store/workspaceIO.ts's `prepareWorkspaceState`,
      // resolve at line 73, abort block 69-80), workbook Copy/Duplicate
      // (store/workbookTransfer.ts:189 and :260 — its own package
      // serializer, same rule), and Pack Project
      // (store/packProjectContent.ts's `serializeCurrentWorkspaceForPack`,
      // both its preview and Start-pack callers — added by BUG-011's fix,
      // which is why this comment previously named only the first of the
      // three and claimed autosave was the sole route).
      //
      // BUG-011 REVIEW (2026-09-13): "resolve first" alone does not
      // guarantee `pending` is unset by the time the payload is built — a
      // NEW lazy book can start pending DURING that resolve await (an
      // import finishing mid-fetch), after the snapshot the resolve step
      // awaited was already taken. Pack Project's serializer re-reads the
      // store after its await and REFUSES if anything is still `pending`
      // rather than trusting the resolve alone (packProjectContent.ts,
      // same file/function as above), so that path is closed there.
      //
      // ROUND 2 CORRECTION: a following paragraph here used to say this SAME
      // window was open on "the two workbook-transfer paths" too. That was
      // FALSE — both call `buildTransferPackage` (lib/workbookTransfer.ts)
      // AFTER their own resolve await, and that function re-reads `pending`
      // on the fresh state it is handed and refuses if anything still is
      // (lib/workbookTransfer.ts:182-183) — a re-check of its own, closing
      // this for workbook Copy/Duplicate already.
      //
      // BUG-011 RESIDUAL CLOSED (2026-09-13): Save/Save As
      // (store/workspaceIO.ts's `prepareWorkspaceState`) carried the
      // identical narrower window — it re-read the store after its own
      // resolve await but did not re-check `pending` on it — recorded above
      // as an open residual while store/workspaceIO.ts was being edited
      // concurrently for BUG-010. Closed the same way as Pack Project's own
      // fix: a post-await re-check (`prepareWorkspaceState`, resolve at
      // `:73`, re-check at `:81-96`) refuses the save by name
      // ("… was still loading") rather than serializing the preview.
      //
      // So the guarantee now holds on every explicit export path — Save,
      // Save As, workbook Copy/Duplicate, and Pack Project all resolve
      // pending datasets first AND refuse rather than serialize a book that
      // turns pending again during that resolve — and `d.pending` should
      // never reach any of their payloads. Only autosave (lib/autosave.ts,
      // which reuses this same serializer for its localStorage snapshot) can
      // LEGITIMATELY still have one — that round-trip is fine, since the
      // render-side ensureBookData hooks re-fetch it the next time that
      // dataset is shown after a reload.
      pending: d.pending,
      ...(d.source ? { source: serializeDatasetSource(d.source, projectDir) } : {}),
      // P1.7 box 5: the lineage breadcrumb for "Import as new version" —
      // dropped entirely before (not just narrowed like `source`), so a
      // saved-and-reopened new-version dataset lost its link to the
      // original outright.
      ...(d.versionOf ? { versionOf: d.versionOf } : {}),
    })),
  };
  return JSON.stringify(doc, encodePersistedCells, 2);
}
