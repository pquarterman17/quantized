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

import { create } from "zustand";

import { importFile, uploadFile } from "../lib/api";
import type { HistoryBatchToken } from "./history";
import { probeSource } from "../lib/desktopBridge";
import { lit } from "../lib/macro";
import { inferErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import { revealAncestorChain } from "../lib/foldertree";
import { planOriginImport } from "../lib/originFolders";
import {
  isLazyBookEntry,
  isPrimaryBookMarker,
  type DataStruct,
  type Dataset,
} from "../lib/types";
import { deriveWorkbooks } from "../lib/workbooks";
import { presentBatchOutcome } from "./importBatchOffers";
import { resolveImportTargetFolderId } from "./importTargetFolder";
import { beginOp, endOp, updateOp } from "./pendingOps";
import { toast } from "./toasts";
import { nextDatasetId, nextFolderId, type AppState } from "./useApp";
import { nextWorkbookId } from "./workbookIds";

// Double-import guard (P3.4 slice 1, 2026-07-26 audit gap #1): the single
// source of truth for "is a batch import running right now". A standalone
// store for the same reason pendingOps/toasts/commands are — session-only UI
// state that must never touch useApp.ts's zero-headroom size ratchet.
//
// `runImport` below is the primary writer (importFiles/importPaths both
// route through it). `commands/fileCommands.ts`'s "import-append" command
// also sets/clears it around its own call: that flow's implementation
// (`importFilesAppended`) lives in useApp.ts, which this slice deliberately
// never touches, so the guard is applied at the command layer for that one
// entry point instead of inside the action itself. Every OTHER import entry
// point (⌘O, the command palette, the Library toolbar button, drag-drop, the
// Recent-files list) calls `importFiles`/`importPaths` directly or through
// `lib/importEntry.ts`'s `chooseAndImport`, so guarding those two actions
// covers all of them from one chokepoint.
interface ImportBatchState {
  running: boolean;
}
export const useImportBatch = create<ImportBatchState>(() => ({ running: false }));

/** True while an import batch is in flight. */
export function isImportRunning(): boolean {
  return useImportBatch.getState().running;
}

/** Shared with commands/fileCommands.ts's pre-flight guard (its own copy of
 *  this check for "import"/"import-append", so those two commands don't even
 *  pop a file dialog while a batch is running) — imported, not retyped, so
 *  the two guard messages can't drift apart. */
export const ALREADY_RUNNING_MSG = "an import is already running — cancel it first";

/** Where one imported payload came from — the only thing the two entry points
 *  disagree about. */
interface ImportOrigin {
  /** Display name (a file's name, or a path's basename). */
  name: string;
  /** Bytes, for the Recent list's tooltip; 0 when unknown (a path import does
   *  not stat the file, and a wrong number would be worse than none). */
  size: number;
  /** Set ONLY for a path import — see `Dataset.source`'s doc for the full
   *  "where a path is/isn't knowable" matrix, including the P1.7
   *  checksum/mtime/size provenance fields threaded through from
   *  `importPaths`'s `probeSource` call below. */
  source?: Dataset["source"];
}

interface ErrorRolesActions {
  /** Replace a dataset's error roles. `[]` clears them. */
  setErrorRoles: (id: string, roles: readonly ErrorBinding[]) => void;
  /** Re-run name inference over the dataset's columns — the "suggested, never
   *  forced" affordance made explicit: the user asks for the guess. */
  detectErrorRoles: (id: string) => number;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

function createErrorRolesActions(set: SliceSet, get: SliceGet): ErrorRolesActions {
  const write = (id: string, roles: readonly ErrorBinding[], label: string) => {
    get().recordHistory(label);
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, errorRoles: roles.length ? [...roles] : undefined } : d,
      ),
    }));
  };

  return {
    setErrorRoles: (id, roles) => write(id, roles, "edit error roles"),

    detectErrorRoles: (id) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds) return 0;
      const found = inferErrorBindings(ds.data);
      write(id, found, "detect error roles");
      return found.length;
    },
  };
}

/** R6 F1/F2 (POST_SPRINT_INDEPENDENT_REVIEW.md code-review round): options
 *  for a batched, self-reporting caller — today only
 *  `store/relink.ts`'s `importChangedAsNewVersion`. Every ordinary caller
 *  (⌘O, drag-drop, the command palette, Recent files, …) omits this entirely
 *  and gets today's unchanged behavior. */
export interface ImportPathsOptions {
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

export interface ImportSlice extends ErrorRolesActions {
  /** Returns the created dataset ids (empty when nothing landed). */
  importFiles: (files: File[]) => Promise<string[]>;
  /** Import real filesystem paths (native desktop dialog, MAIN_PLAN #31). Each
   *  dataset carries `source.path`, so re-import needs no second picker.
   *  Returns the created dataset ids (empty when nothing landed) — the
   *  caller's own authoritative record of what THIS call created, never a
   *  before/after set-diff against the live store (R6 F2: a diff mislabels
   *  ANY dataset a concurrent, unblocked action — paste, demo, merge — adds
   *  during the same window as this call's own). */
  importPaths: (paths: string[], opts?: ImportPathsOptions) => Promise<string[]>;
}


/** Basename without directory — the display name for a path import. */
export function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
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
  // MAIN #33 provenance: what this import DECIDED, recorded on the dataset
  // rather than inferred later. The original file is never written to, so
  // this is the only place the decisions can survive. ONE timestamp per
  // import call — every dataset this call creates, including every book of
  // a multi-book Origin project below, shares this same `importedAt`.
  const importedAt = new Date().toISOString();
  const figures = data.figures;
  const fidelity = data.origin_fidelity;
  delete data.figures;
  delete data.origin_fidelity;
  const newIds: string[] = [];
  if (data.books && data.books.length > 1) {
    // Origin project: import every workbook as its own dataset. Per
    // ORIGIN_FILE_DECODE_PLAN #38, `book` is one of three shapes: the PRIMARY
    // book's no-data marker (its real time/values are at the top-level `data`
    // instead), another book's lazy preview (small preview time/values now,
    // full data fetched on first activation — `pending` records how), or —
    // only under the `full_books` escape hatch, never requested here — a full
    // inline DataStruct.
    const bookSource = data.book_source;
    // FU-1 provenance fix: every book below now gets `importedAt` + inferred
    // error roles, matching the single-file `else` branch further down.
    // `bookData` is always exactly what that dataset's `data` field carries,
    // so `importRoles` infers off THIS book's own labels. For the lazy shape,
    // `book.labels`/`book.units` are ALSO the real, full-book values (only
    // `time`/`values` are a downsampled preview — LazyBookEntry's own doc),
    // and `inferErrorBindings` reads `.labels` alone, so inferring from them
    // here is not a preview-degraded guess: it's the same result the eventual
    // full-data fetch would produce.
    for (const book of data.books) {
      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      const short = String(meta.origin_book ?? "Book");
      const long = String(meta.origin_book_long ?? "");
      const label = long && long !== short ? `${short} — ${long}` : short;
      const id = nextDatasetId();
      const name = `${stem}:${label}`;
      if (isPrimaryBookMarker(book)) {
        const bookData = { time: data.time, values: data.values, labels: book.labels, units: book.units, metadata: book.metadata };
        get().addDataset({ id, name, data: bookData, ...src, ...importRoles(bookData), importedAt }, historyToken);
      } else if (isLazyBookEntry(book)) {
        const bookData = { time: book.preview.time, values: book.preview.values, labels: book.labels, units: book.units, metadata: book.metadata };
        get().addDataset({
          id,
          name,
          data: bookData,
          ...(bookSource
            ? { pending: { ...bookSource, bookId: book.id, rows: book.rows, cols: book.cols } }
            : {}),
          ...src,
          ...importRoles(bookData),
          importedAt,
        }, historyToken);
      } else {
        get().addDataset({ id, name, data: book, ...src, ...importRoles(book), importedAt }, historyToken);
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
    const id = nextDatasetId();
    const dsInput: Dataset = {
      id, name: origin.name, data, ...src, ...importRoles(data), importedAt,
      ...(targetFolderId ? { folderId: targetFolderId } : {}),
    };
    get().addDataset(dsInput, historyToken);
    newIds.push(id);
    // LIBRARY_WORKBOOK_UX_PLAN PR A3: one workbook per imported source file
    // (L0.2), or per book for a single-book Origin project (its origin_book
    // metadata already survived onto dsInput.data.metadata — the `books`
    // branch above only fires for length > 1). deriveWorkbooks decides
    // which, the SAME way a reload would, so import-time creation and
    // load-time derivation can never disagree (the plan's consistency gate).
    const derived = deriveWorkbooks([dsInput], [], nextWorkbookId);
    set((s) => ({
      workbooks: [...s.workbooks, ...derived.workbooks],
      // A single-file (0/1-book) import creates exactly ONE new workbook, so
      // it starts expanded unconditionally: the just-imported sheet must be
      // immediately visible, not behind a collapsed disclosure. UX-R3's
      // multi-book branch above deliberately does NOT do this for what IT
      // creates (project scale: auto-expanding every one is the "too many
      // similarly weighted objects" complaint that branch exists to fix).
      expandedWorkbookIds: [...new Set([...s.expandedWorkbookIds, ...derived.workbooks.map((w) => w.id)])],
      datasets: s.datasets.map((d) => (d.id === id ? { ...d, workbookId: derived.membership[id] } : d)),
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
  load: (item: T, signal: AbortSignal) => Promise<{ data: DataStruct; origin: ImportOrigin }>,
  historyToken?: HistoryBatchToken,
  presentOutcome = true,
): Promise<string[]> {
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
  if (useImportBatch.getState().running) {
    get().setStatus(ALREADY_RUNNING_MSG);
    toast(ALREADY_RUNNING_MSG, "danger");
    return [];
  }

  const controller = new AbortController();
  const label = (i: number): string =>
    items.length > 1
      ? `Importing ${i + 1}/${items.length}: ${describe(items[i])}…`
      : `Importing ${describe(items[0])}…`;
  const opId = beginOp(label(0), () => controller.abort());
  useImportBatch.setState({ running: true });
  // L0.46: resolved ONCE per batch — librarySelection doesn't change mid-batch.
  const targetFolderId = resolveImportTargetFolderId(get);

  let added = 0;
  let lastError = "";
  let cancelled = false;
  const createdIds: string[] = [];
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
        const { data, origin } = await load(item, controller.signal);
        createdIds.push(...addFromPayload(set, get, data, origin, targetFolderId, historyToken));
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
    return createdIds; // files already fully imported STAY — see this function's own doc
  }

  // A parse failure is the wizard's second front door (#40): the auto-detect
  // path gave up, so point at the manual guess/preview/parse one instead of
  // just reporting the error.
  const hint = " — try the Import wizard (⌘K → Import wizard…)";
  const summary = lastError
    ? `imported ${added}/${items.length} — failed ${lastError}${hint}`
    : `imported ${added} file${added === 1 ? "" : "s"}`;
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
  if (added > 0 && presentOutcome) await presentBatchOutcome(get, added, createdIds, targetFolderId);
  if (lastError) toast(`${lastError}${hint}`, "danger");
  return createdIds;
}

export function createImportSlice(set: SliceSet, get: SliceGet): ImportSlice {
  return {
    // Error-role editing rides the same slice: this module already OWNS the
    // roles (it infers them at import), and splitting the seed from the edit
    // is how the two drift into different ideas of what a binding means.
    ...createErrorRolesActions(set, get),
    importFiles: (files) =>
      runImport(set, get, files, (f) => f.name, async (file, signal) => ({
        data: await uploadFile(file, signal),
        origin: { name: file.name, size: file.size },
      })),

    importPaths: (paths, opts) =>
      runImport(set, get, paths, pathBasename, async (path, signal) => {
        const data = await importFile(path, signal);
        // P1.7 / L0.32 provenance: "record source path, import time,
        // observed modification time, and a checksum where practical".
        // `probeSource` returns null with no bridge (a browser tab, or a
        // test with no mock) — degrades to path-only provenance rather
        // than failing the import; a native pick already granted this
        // exact path read consent moments ago (lib/importEntry.ts's
        // `chooseAndImport` -> `pick_files`), so the checksum is real
        // whenever a bridge is present at all.
        const probe = await probeSource(path);
        const source: Dataset["source"] =
          probe?.state === "ok"
            ? {
                kind: "path",
                path,
                ...(probe.checksum != null ? { checksum: probe.checksum } : {}),
                ...(probe.mtime != null ? { mtime: probe.mtime } : {}),
                ...(probe.size != null ? { size: probe.size } : {}),
              }
            : { kind: "path", path };
        // The path is what makes this import re-importable without a picker.
        return { data, origin: { name: pathBasename(path), size: probe?.size ?? 0, source } };
      }, opts?.historyToken, opts?.presentOutcome ?? true),
  };
}

/** Seed the canonical error-column roles from the parsed labels (MAIN #33).
 *
 *  Inference SUGGESTS — it only binds where the pairing is unambiguous or
 *  follows the instrument convention, and everything stays overridable. Omitted
 *  entirely when nothing is inferable, so an ordinary two-column file carries
 *  no empty role list. */
function importRoles(data: DataStruct): { errorRoles?: ErrorBinding[] } {
  const roles = inferErrorBindings(data);
  return roles.length ? { errorRoles: roles } : {};
}
