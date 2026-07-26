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

import { create } from "zustand";

import { importFile, uploadFile } from "../lib/api";
import { lit } from "../lib/macro";
import { inferErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import { planOriginFolders } from "../lib/originFolders";
import { isLazyBookEntry, isPrimaryBookMarker, type DataStruct } from "../lib/types";
import { beginOp, endOp, updateOp } from "./pendingOps";
import { toast } from "./toasts";
import { nextDatasetId, nextFolderId, type AppState } from "./useApp";

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
   *  "where a path is/isn't knowable" matrix. */
  source?: { kind: "path"; path: string };
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

export interface ImportSlice extends ErrorRolesActions {
  importFiles: (files: File[]) => Promise<void>;
  /** Import real filesystem paths (native desktop dialog, MAIN_PLAN #31). Each
   *  dataset carries `source.path`, so re-import needs no second picker. */
  importPaths: (paths: string[]) => Promise<void>;
}


/** Basename without directory — the display name for a path import. */
export function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Expand ONE parsed payload into datasets. Extracted verbatim from the old
 *  `importFiles` body so the Origin branch keeps behaving exactly as before;
 *  the only addition is threading `origin.source` onto every dataset it
 *  creates. Throws on failure — callers own the per-file error summary. */
function addFromPayload(
  set: SliceSet,
  get: SliceGet,
  data: DataStruct,
  origin: ImportOrigin,
): void {
  const stem = origin.name.replace(/\.[^.]+$/, "");
  const src = origin.source ? { source: origin.source } : {};
  // MAIN #33 provenance: what this import DECIDED, recorded on the dataset
  // rather than inferred later. The original file is never written to, so
  // this is the only place the decisions can survive.
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
    for (const book of data.books) {
      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      const short = String(meta.origin_book ?? "Book");
      const long = String(meta.origin_book_long ?? "");
      const label = long && long !== short ? `${short} — ${long}` : short;
      const id = nextDatasetId();
      if (isPrimaryBookMarker(book)) {
        get().addDataset({
          id,
          name: `${stem}:${label}`,
          data: {
            time: data.time,
            values: data.values,
            labels: book.labels,
            units: book.units,
            metadata: book.metadata,
          },
          ...src,
        });
      } else if (isLazyBookEntry(book)) {
        get().addDataset({
          id,
          name: `${stem}:${label}`,
          data: {
            time: book.preview.time,
            values: book.preview.values,
            labels: book.labels,
            units: book.units,
            metadata: book.metadata,
          },
          ...(bookSource
            ? { pending: { ...bookSource, bookId: book.id, rows: book.rows, cols: book.cols } }
            : {}),
          ...src,
        });
      } else {
        get().addDataset({ id, name: `${stem}:${label}`, data: book, ...src });
      }
      newIds.push(id);
    }
    // item 4: organize the imported books into a project folder that mirrors
    // Origin's Project Explorer (origin_folder_path) → book → sheet, instead of
    // dumping N workbooks flat into the Library.
    const newIdSet = new Set(newIds);
    const projectDatasets = get().datasets.filter((d) => newIdSet.has(d.id));
    const plan = planOriginFolders(stem, projectDatasets, nextFolderId);
    set((s) => ({
      folders: [...s.folders, ...plan.folders],
      expandedFolders: [...new Set([...s.expandedFolders, ...plan.expanded])],
      datasets: s.datasets.map((d) =>
        plan.membership[d.id] ? { ...d, folderId: plan.membership[d.id] } : d,
      ),
    }));
  } else {
    delete data.books;
    delete data.book_source;
    const id = nextDatasetId();
    get().addDataset({
      id,
      name: origin.name,
      data,
      ...src,
      ...importRoles(data),
      importedAt,
    });
    newIds.push(id);
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
): Promise<void> {
  if (useImportBatch.getState().running) {
    get().setStatus(ALREADY_RUNNING_MSG);
    toast(ALREADY_RUNNING_MSG, "danger");
    return;
  }

  const controller = new AbortController();
  const label = (i: number): string =>
    items.length > 1
      ? `Importing ${i + 1}/${items.length}: ${describe(items[i])}…`
      : `Importing ${describe(items[0])}…`;
  const opId = beginOp(label(0), () => controller.abort());
  useImportBatch.setState({ running: true });

  let added = 0;
  let lastError = "";
  let cancelled = false;
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
        addFromPayload(set, get, data, origin);
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
    return;
  }

  // A parse failure is the wizard's second front door (#40): the auto-detect
  // path gave up, so point at the manual guess/preview/parse one instead of
  // just reporting the error.
  const hint = " — try the Import wizard (⌘K → Import wizard…)";
  const summary = lastError
    ? `imported ${added}/${items.length} — failed ${lastError}${hint}`
    : `imported ${added} file${added === 1 ? "" : "s"}`;
  get().setStatus(summary);
  if (added > 0) toast(`imported ${added} file${added === 1 ? "" : "s"}`, "ok");
  if (lastError) toast(`${lastError}${hint}`, "danger");
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

    importPaths: (paths) =>
      runImport(set, get, paths, pathBasename, async (path, signal) => ({
        data: await importFile(path, signal),
        // The path is what makes this import re-importable without a picker.
        origin: { name: pathBasename(path), size: 0, source: { kind: "path", path } },
      })),
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
