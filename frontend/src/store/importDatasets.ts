// The import slice (MAIN_PLAN #31): turn a parsed payload into Library
// datasets, from EITHER an uploaded File or a real filesystem path.
//
// Extracted from useApp.ts's 109-line `importFiles` because #31 needs a second
// entry point — a native OS dialog hands back a PATH, not a File — and the
// per-file body it would otherwise have to duplicate is the tricky part:
// Origin multi-book expansion, lazy-book `pending` refs, project-folder
// planning, figures/fidelity attachment, macro + recents. Two copies of that
// would drift, and the Origin branch is exactly where a drift would be
// expensive and hard to notice.
//
// So both actions share `addFromPayload` and differ only in how they FETCH:
// `/upload` (bytes; the browser can never know a path) versus
// `/api/parsers/import` (a path the backend has already validated and, for a
// natively picked file, consented to — see quantized/desktop_consent.py). The
// path branch is also the only one that can set `Dataset.source`, which is what
// makes "re-import from source" work without asking the picker again.
//
// It also owns ERROR ROLES end to end (MAIN #33/#36): inferred here at import,
// and edited through the slice below. Keeping the seed and the edit in one
// module is what stops the two drifting into different ideas of what a
// binding means.
//
// PLOT_WORKFLOW_PLAN item 4: `runImport` is also the batch's one finish
// line, so it's the chokepoint for the batch-overlay offer — see
// `batchOverlayOffer` below.

import { plural } from "../lib/plural";

import type { HistoryBatchToken } from "./history";
import { lit } from "../lib/macro";
import { revealAncestorChain } from "../lib/foldertree";
import { originBookErrorRoles } from "../lib/originBookRoles";
import { planOriginImport } from "../lib/originFolders";
import { asPreviewSourceRows, PREVIEW_SOURCE_ROWS } from "../lib/rowSidecars";
import {
  isLazyBookEntry,
  isPrimaryBookMarker,
  type DataStruct,
  type Dataset,
} from "../lib/types";
import { deriveWorkbooks } from "../lib/workbooks";
import { sheetDatasetName, splitSheets } from "../lib/workbookSheets";
import { DEFAULT_MAP_VIEW } from "../lib/mapView";
import { is2DMap } from "../lib/mapdata";
import { techniqueOf } from "../lib/techniqueDefaults";
import { ALREADY_RUNNING_MSG, useImportBatch } from "./importBatch";
import { presentBatchOutcome } from "./importBatchOffers";
import { createErrorRolesActions, seedErrorRoles, type ErrorRolesActions } from "./importErrorRoles";
import type { StructurePreset } from "./crystalStructures";
import { loadPath, loadUpload, pathBasename, presentStructures, type ImportLoad, type ImportOrigin } from "./importLoaders";
import { notifyParserNotes, parserNotes } from "./importNotes";
import { resolveImportTargetFolderId } from "./importTargetFolder";
import { beginOp, endOp, updateOp, type OpId } from "./pendingOps";
import { toast } from "./toasts";
import { nextDatasetId, nextFolderId } from "./idSeq";
import type { AppState } from "./useApp";
import { nextWorkbookId } from "./workbookIds";

export { pathBasename };

// Double-import guard: its state lives in ./importBatch (eager — the command
// layer reads it synchronously) since bundle headroom slice 10, which made
// this module load on first import. Import it from there directly — the
// guard names are no longer re-exported from here.

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Knobs `runImport` accepts ONLY from `importDatasetsLazy.ts`'s cold path and
 *  `importFilesAppended`'s fallback — never an ordinary import entry point.
 *  Folded into `ImportFilesOptions`/`ImportPathsOptions` below rather than
 *  kept as separate parameters, since both already flow down to `runImport`. */
interface InternalRunOptions {
  /** Skip the initial refuse-check AND skip (re)claiming the guard, because
   *  the caller already holds it — the lazy wrapper's own synchronous
   *  cold-path claim (closing a race `fileCommands.ts`'s
   *  `rejectIfImportRunning` could otherwise win); or `importFilesAppended`'s
   *  fallback, called while "import-append" already holds it. Cleared
   *  normally in the `finally` below either way — ownership fully transfers. */
  bypassGuard?: boolean;
  /** Continue this existing pendingOps entry (the lazy wrapper's own "loading
   *  the importer…" op) instead of registering a new one — ONE continuous
   *  StatusBar entry across the chunk fetch and the imports that follow. */
  existingOpId?: OpId;
}

/** R6 F1/F2 (POST_SPRINT_INDEPENDENT_REVIEW.md code-review round): options
 *  for a batched, self-reporting caller — today only
 *  `store/relink.ts`'s `importChangedAsNewVersion`. Every ordinary caller
 *  (⌘O, drag-drop, the command palette, Recent files, …) omits this entirely
 *  and gets today's unchanged behavior. */
export interface ImportPathsOptions extends InternalRunOptions {
  /** Forward an enclosing `withHistoryBatch`'s token so every dataset this
   *  call creates folds into that batch's ONE undo entry instead of each
   *  recording its own. */
  historyToken?: HistoryBatchToken;
  /** Skip `presentBatchOutcome` (the overlay/folder/recipe-suggestion/plain
   *  "imported N" toast cascade) entirely. Default `true`. F1: that cascade's
   *  recipe-suggestion branch makes REAL awaits (a dynamic import, an async
   *  recipe match) — sitting inside an enclosing `withHistoryBatch` window
   *  AFTER its last fold, that latency reopened exactly the gap the batch-
   *  token fix was meant to close (a foreign edit landing there was still
   *  corrupted by the batch's fold-time-frozen snapshot on undo, since this
   *  is a snapshot-restore design — see `HistoryBatchToken`'s doc,
   *  store/history.ts). `importChangedAsNewVersion` passes `false`: that
   *  gesture already reports its own "imported ... as a new version"
   *  outcome, so a second, generic offer toast on top would double up
   *  anyway — this is correct L0.46 behavior, not only a history-safety
   *  patch. */
  presentOutcome?: boolean;
}

/** Internal-only; see `InternalRunOptions`'s doc. */
export type ImportFilesOptions = InternalRunOptions;

export interface ImportSlice extends ErrorRolesActions {
  /** Returns the created dataset ids (empty when nothing landed). */
  importFiles: (files: File[], opts?: ImportFilesOptions) => Promise<string[]>;
  /** Import real filesystem paths (native desktop dialog, MAIN_PLAN #31). Each
   *  dataset carries `source.path`, so re-import needs no second picker.
   *  Returns the created dataset ids (empty when nothing landed) — the
   *  caller's own authoritative record of what THIS call created, never a
   *  before/after set-diff against the live store (R6 F2: a diff mislabels
   *  ANY dataset a concurrent, unblocked action — paste, demo, merge — adds
   *  during the same window as this call's own). */
  importPaths: (paths: string[], opts?: ImportPathsOptions) => Promise<string[]>;
}

/** Expand ONE parsed payload into datasets. Extracted verbatim from the old
 *  `importFiles` body so the Origin branch keeps behaving exactly as before;
 *  the only additions are threading `origin.source` onto every dataset it
 *  creates and L0.46's import-target folder. Throws on failure — callers own
 *  the per-file error summary. Returns the created dataset id(s) (item 4's
 *  batch-overlay offer needs them to know what a batch actually landed). */
function addFromPayload(
  set: SliceSet,
  get: SliceGet,
  data: DataStruct,
  origin: ImportOrigin,
  targetFolderId: string | undefined,
  historyToken: HistoryBatchToken | undefined,
): string[] {
  const stem = origin.name.replace(/\.[^.]+$/, "");
  const src = origin.source ? { source: origin.source } : {};
  // MAIN #33 provenance: recorded on the dataset -- one timestamp per import call.
  const importedAt = new Date().toISOString();
  const figures = data.figures;
  const fidelity = data.origin_fidelity;
  delete data.figures;
  delete data.origin_fidelity;
  const newIds: string[] = [];
  if (data.books && data.books.length > 1) {
    // Origin project: import every workbook as its own dataset. Per
    // ORIGIN_FILE_DECODE_PLAN #38, `book` is one of three shapes: the PRIMARY
    // book's no-data marker (real time/values at the top-level `data`
    // instead), another book's lazy preview (preview now, full data fetched
    // on first activation — `pending` records how), or — only under the
    // `full_books` escape hatch, never requested here — a full inline DataStruct.
    const bookSource = data.book_source;
    // FU-1: every book gets `importedAt` + designation-derived error roles
    // (never the label guess) — see `originBookErrorRoles`'s doc. `?? {}`
    // here: unlike the single-file branch below, this NEVER falls back to
    // the label guess even when a book has no usable designation info.
    for (const book of data.books) {
      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      const short = String(meta.origin_book ?? "Book");
      const long = String(meta.origin_book_long ?? "");
      const label = long && long !== short ? `${short} — ${long}` : short;
      const id = nextDatasetId();
      const name = `${stem}:${label}`;
      const roles = originBookErrorRoles(book) ?? {};
      if (isPrimaryBookMarker(book)) {
        const bookData = { time: data.time, values: data.values, labels: book.labels, units: book.units, metadata: book.metadata };
        get().addDataset({ id, name, data: bookData, ...src, ...roles, importedAt }, historyToken);
      } else if (isLazyBookEntry(book)) {
        // The preview's rows are the book's FULL metadata's rows only when the
        // backend says so; when it sampled them it also says WHICH rows it kept,
        // and that map travels on the PREVIEW's own metadata (BUG-006 site 10).
        // It belongs there, not on `pending`: the 30-odd readers of a row-indexed
        // sidecar hold a `DataStruct` and nothing else, and the map describes
        // exactly the rows it travels with — so `bookData.installBookData`
        // replacing `.data` wholesale on arrival retires it at the same instant
        // the preview it describes stops existing. Validated here (and again at
        // every read) so a hand-edited `.dwk` cannot turn it into wrong labels.
        //
        // A preview the backend did NOT sample but that is still SHORTER than the
        // book gets the IDENTITY map synthesized here. That shape is the padding
        // trim (`preview.py::_trim_trailing_padding`; Book15 drops 19 of 180
        // rows), a strict PREFIX whose row r IS source row r — so the backend
        // correctly sends no map. But a reader holding only the DataStruct sees a
        // sidecar longer than its rows and cannot tell that prefix from a sample,
        // so it degraded to numbers. The identity map is the missing evidence,
        // built from a row count this branch already has, for zero wire cost.
        // `preview_sampled === false` is the load-bearing half: `undefined` (an
        // older backend) stays unmapped, since the prefix is what it cannot
        // vouch for.
        const previewRows = book.preview.time.length;
        const sourceRows =
          asPreviewSourceRows(book.preview_rows, previewRows, book.rows) ??
          (book.preview_sampled === false && previewRows < book.rows
            ? Array.from({ length: previewRows }, (_, i) => i)
            : null);
        const bookMeta = sourceRows
          ? { ...book.metadata, [PREVIEW_SOURCE_ROWS]: sourceRows }
          : book.metadata;
        const bookData = { time: book.preview.time, values: book.preview.values, labels: book.labels, units: book.units, metadata: bookMeta };
        get().addDataset({
          id,
          name,
          data: bookData,
          ...(bookSource
            ? {
                pending: {
                  ...bookSource,
                  bookId: book.id,
                  rows: book.rows,
                  cols: book.cols,
                  previewSampled: book.preview_sampled,
                },
              }
            : {}),
          ...src,
          ...roles,
          importedAt,
        }, historyToken);
      } else {
        get().addDataset({ id, name, data: book, ...src, ...roles, importedAt }, historyToken);
      }
      newIds.push(id);
    }
    // item 4 / LIBRARY_WORKBOOK_UX_PLAN PR A3: organize the imported books
    // into a project folder that mirrors Origin's Project Explorer
    // (origin_folder_path), and give each book its own workbook (L0.1/L0.2)
    // — no more per-book folder standing in for it.
    const newIdSet = new Set(newIds);
    const projectDatasets = get().datasets.filter((d) => newIdSet.has(d.id));
    const plan = planOriginImport(stem, projectDatasets, nextFolderId, nextWorkbookId, targetFolderId ?? null);
    // UX-R3 (ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md): a multi-book Origin
    // project can create dozens of folders/workbooks in one import, so this
    // branch lands COLLAPSED at both layers (`plan.folders`/`plan.workbooks`
    // deliberately NOT merged into expandedFolders/expandedWorkbookIds) —
    // the owner-observed "too many similarly weighted objects" complaint.
    // Nothing is hidden-with-no-path-back; only the DEFAULT disclosure depth
    // changes. A single-file import (the `else` below) keeps its immediate
    // auto-expand, unchanged. F1 exception: the active dataset's ancestor
    // chain IS revealed (`revealAncestorChain`'s doc) — computed INSIDE this
    // same `set()`, so no subscriber ever observes the forbidden transient.
    const activeId = get().activeId;
    set((s) => {
      const folders = [...s.folders, ...plan.folders];
      const reveal = activeId
        ? revealAncestorChain(
            { ...s, folders },
            plan.folderMembership[activeId],
            plan.workbookMembership[activeId],
          )
        : {};
      return {
        folders,
        workbooks: [...s.workbooks, ...plan.workbooks],
        datasets: s.datasets.map((d) =>
          newIdSet.has(d.id)
            ? { ...d, folderId: plan.folderMembership[d.id], workbookId: plan.workbookMembership[d.id] }
            : d,
        ),
        ...reveal,
      };
    });
  } else {
    delete data.books;
    delete data.book_source;
    // Plot audit r2: a multi-sheet Excel workbook brings every data sheet;
    // each is its own dataset in the ONE workbook below (lib/workbookSheets).
    const sheets = splitSheets(data);
    // L1: a single-book `.opj`/`.opju` import (books.length <= 1, probably
    // the MORE common file) took this branch and used ONLY the label guess —
    // the same harm E1 fixed for the multi-book branch above. Prefer Origin's
    // designations here too; a genuinely non-Origin file (`null`) is unchanged.
    const inputs: Dataset[] = sheets.map((sheet) => ({
      id: nextDatasetId(), name: sheetDatasetName(origin.name, sheet, sheets.length), data: sheet, ...src,
      ...seedErrorRoles(sheet),
      importedAt,
      ...(targetFolderId ? { folderId: targetFolderId } : {}),
    }));
    for (const dsInput of inputs) {
      get().addDataset(dsInput, historyToken);
      // RSM / pole-figure intensities span decades: open on a log colour scale.
      // Stored as an ENTRY (not a technique-aware absent default), so it saves
      // with the document, a later switch to linear saves and reloads as linear,
      // and an older .dwk's untouched maps load exactly as they did.
      if (techniqueOf(dsInput) === "xrd.rsm" && is2DMap(dsInput.data)) {
        set((s) => ({ mapViews: { ...s.mapViews, [dsInput.id]: { ...DEFAULT_MAP_VIEW, logZ: true } } }));
      }
      newIds.push(dsInput.id);
    }
    // LIBRARY_WORKBOOK_UX_PLAN PR A3: one workbook per imported source file
    // (L0.2), or per book for a single-book Origin project (its origin_book
    // metadata already survived onto dsInput.data.metadata — the `books`
    // branch above only fires for length > 1). deriveWorkbooks decides
    // which, the SAME way a reload would, so import-time creation and
    // load-time derivation can never disagree (the plan's consistency gate).
    // Every other sheet joins the first one's workbook (L0.3).
    const derived = deriveWorkbooks([inputs[0]], [], nextWorkbookId);
    const workbookId = derived.membership[inputs[0].id];
    if (sheets.length > 1 && !src.source) derived.workbooks[0].name = origin.name;
    const mine = new Set(newIds);
    set((s) => ({
      workbooks: [...s.workbooks, ...derived.workbooks],
      // A single-file (0/1-book) import creates exactly ONE new workbook, so
      // it starts expanded unconditionally: the just-imported sheet must be
      // immediately visible, not behind a collapsed disclosure. UX-R3's
      // multi-book branch above deliberately does NOT do this for what IT
      // creates (project scale: auto-expanding every one is the "too many
      // similarly weighted objects" complaint that branch exists to fix).
      expandedWorkbookIds: [...new Set([...s.expandedWorkbookIds, ...derived.workbooks.map((w) => w.id)])],
      datasets: s.datasets.map((d) => (mine.has(d.id) ? { ...d, workbookId } : d)),
    }));
  }
  if (figures?.length) get().addOriginFigures(stem, figures, newIds);
  if (fidelity) {
    get().addOriginFidelity(stem, fidelity, newIds);
    toast(
      `${stem}: ${fidelity.graph_records_actionable}/${fidelity.graph_records_total} Origin graph records are editable; fidelity details saved`,
      "info",
    );
  }
  get().recordMacro(`Import ${origin.name}`, `qz.import(${lit(origin.name)})`, {
    kind: "import",
    params: { name: origin.name },
  });
  get().pushRecent(origin.name, origin.size, origin.source?.path);
  return newIds;
}

/** Shared per-batch loop + status/toast summary.
 *
 *  P3.4 slice 1: registers ONE pendingOps entry for the whole batch (label
 *  ticks forward per file via `updateOp`, not a new op each time — see that
 *  module's doc for why), carries a `cancel` that aborts the in-flight
 *  fetch via a single AbortController shared across every file in the
 *  batch, and guards against a second batch starting while this one runs.
 *
 *  Cancel semantics: files already fully imported STAY (added to the
 *  library, undo-recorded, macro-recorded) — cancelling stops the NEXT file
 *  from starting, it does not roll back completed ones. That is the honest
 *  semantic for a batch: "imported 2 of 5, then stopped" rather than an
 *  all-or-nothing transaction the user never asked for. The aborted file's
 *  own fetch rejects (caught below, `data`/`origin` never assigned, so
 *  `addFromPayload` never runs for it — no partial dataset lands); the
 *  backend may still finish parsing that one request server-side, which is
 *  harmless since the client just discards the response. */
async function runImport<T>(
  set: SliceSet,
  get: SliceGet,
  items: T[],
  describe: (item: T) => string,
  load: (item: T, signal: AbortSignal) => Promise<ImportLoad>,
  historyToken?: HistoryBatchToken,
  presentOutcome = true,
  internal: InternalRunOptions = {},
): Promise<string[]> {
  const { bypassGuard = false, existingOpId } = internal;
  // DEFECT B fallout (Sol audit P1-6, 2026-08-21): `importFiles`/`importPaths`
  // are called directly (no length guard) by several `openFilePicker` sites
  // — lib/importEntry.ts, useGlobalShortcuts.ts, lib/reopenRecent.ts (x3) —
  // now that a canceled picker settles with `onPick([])` instead of never
  // firing. Without this guard `label(0)` below reads `describe(items[0])`
  // on an empty array and throws. A single choke point here (rather than
  // patching every one of those call sites) protects every current AND
  // future caller the same way; a silent no-op matches every other
  // openFilePicker cancel path in this codebase (no status/toast change).
  if (items.length === 0) return [];
  // bypassGuard: the caller already holds the guard — see InternalRunOptions.
  if (!bypassGuard && useImportBatch.getState().running) {
    get().setStatus(ALREADY_RUNNING_MSG);
    toast(ALREADY_RUNNING_MSG, "danger");
    return [];
  }

  const controller = new AbortController();
  const label = (i: number): string =>
    items.length > 1
      ? `Importing ${i + 1}/${items.length}: ${describe(items[i])}…`
      : `Importing ${describe(items[0])}…`;
  // existingOpId: continue the lazy wrapper's own op instead of a second one.
  const opId = existingOpId ?? beginOp(label(0), () => controller.abort());
  if (existingOpId !== undefined) updateOp(existingOpId, label(0), () => controller.abort());
  if (!bypassGuard) useImportBatch.setState({ running: true });
  // L0.46: resolved ONCE per batch — librarySelection doesn't change mid-batch.
  const targetFolderId = resolveImportTargetFolderId(get);

  let added = 0;
  let lastError = "";
  let cancelled = false;
  const createdIds: string[] = [];
  const structures: StructurePreset[] = []; // .cif: lattice presets, not datasets
  const noted: { name: string; notes: string[] }[] = []; // parser notes (importNotes.ts)
  try {
    for (let i = 0; i < items.length; i++) {
      if (controller.signal.aborted) {
        cancelled = true;
        break;
      }
      const item = items[i];
      updateOp(opId, label(i));
      get().setStatus(`importing ${describe(item)}…`);
      try {
        const loaded = await load(item, controller.signal);
        if ("structure" in loaded) structures.push(loaded.structure);
        else {
          noted.push({ name: describe(item), notes: parserNotes(loaded.data) });
          createdIds.push(...addFromPayload(set, get, loaded.data, loaded.origin, targetFolderId, historyToken));
        }
        added += 1;
      } catch (e) {
        // A rejection that lands after cancel() was called is the abort,
        // regardless of what the fetch layer happened to throw for it —
        // checking the controller's own flag (rather than matching an
        // error name/class) is robust to every fetch/mock implementation.
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        lastError = `${describe(item)}: ${e instanceof Error ? e.message : "error"}`;
      }
    }
  } finally {
    endOp(opId);
    useImportBatch.setState({ running: false });
  }

  if (cancelled) {
    const summary = `import cancelled — ${added}/${items.length} completed`;
    get().setStatus(summary);
    toast(summary, "info");
    notifyParserNotes(noted);
    return createdIds; // files already fully imported STAY — see this function's own doc
  }

  // A parse failure is the wizard's second front door (#40): the auto-detect
  // path gave up, so point at the manual guess/preview/parse one instead of
  // just reporting the error.
  const hint = " — try the Import wizard (⌘K → Import wizard…)";
  const summary = lastError
    ? `imported ${added}/${items.length} — failed ${lastError}${hint}`
    : `imported ${added} file${plural(added)}`;
  get().setStatus(summary);
  // P2 review fix: `added` (files actually imported), not createdIds.length
  // (datasets created) — a multi-book Origin file inflates the latter. The
  // toast cascade itself (overlay / folder / P1.3 wave-3 recipe-suggestion /
  // plain fallback, ranked per L0.46) lives in importBatchOffers.ts — see
  // that module's header for the full precedence rationale.
  // F1 (R6 code-review): `presentOutcome` gates the ENTIRE cascade, not just
  // whether a toast fires — its recipe-suggestion branch's real awaits (a
  // dynamic import, an async recipe match) must never run at all for a
  // caller that has its own `withHistoryBatch` wrapped around this call, per
  // `ImportPathsOptions.presentOutcome`'s own doc.
  const dataAdded = added - structures.length;
  if (structures.length > 0) presentStructures(structures);
  if (dataAdded > 0 && presentOutcome) await presentBatchOutcome(get, dataAdded, createdIds, targetFolderId);
  // P3.4 error-quality audit (2026-09-14, deduped in the review round): the
  // toast carries the "whether data changed" fact too. The status line said
  // "imported 3/5 — failed …" while the toast — what actually appears over
  // the stage — named only the broken file. Reuses `summary`, already built
  // above to this exact string, rather than re-interpolating it.
  if (lastError) toast(summary, "danger");
  notifyParserNotes(noted);
  return createdIds;
}

export function createImportSlice(set: SliceSet, get: SliceGet): ImportSlice {
  return {
    // Error-role editing rides the same slice: this module already OWNS the
    // roles (it infers them at import), and splitting the seed from the edit
    // is how the two drift into different ideas of what a binding means.
    ...createErrorRolesActions(set, get),
    importFiles: (files, opts) =>
      runImport(set, get, files, (f) => f.name, loadUpload, undefined, true,
        { bypassGuard: opts?.bypassGuard, existingOpId: opts?.existingOpId }),

    importPaths: (paths, opts) =>
      runImport(set, get, paths, pathBasename, loadPath, opts?.historyToken, opts?.presentOutcome ?? true,
        { bypassGuard: opts?.bypassGuard, existingOpId: opts?.existingOpId }),
  };
}
