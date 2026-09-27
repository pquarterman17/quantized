// On-demand loader for the import slice (bundle headroom slice 10,
// `plans/BUNDLE_HEADROOM.md`) — the `store/reimportLazy.ts` shape.
//
// `store/importDatasets.ts` turns a parsed payload into Library datasets
// (Origin multi-book expansion, lazy-book refs, project-folder planning, the
// batch-outcome toast cascade), and with it `lib/workbooks.ts`,
// `lib/originFolders.ts`, `lib/datasetSource.ts`, `lib/bundlePath.ts`,
// `store/importBatchOffers.ts` and `store/importTargetFolder.ts`, which only it
// reached eagerly. Its slice was composed straight into `useApp.ts`, so all of
// that was a startup cost for work that only ever runs after the user picks,
// drops or reopens a file. Both actions were ALREADY `async` (each fetches the
// payload over the network before touching the store), so this composes an
// identically-typed slice whose two actions fetch the real ones on first use;
// no public signature changes.
//
// What stays eager, and why:
// - the error-role EDIT actions (`./importErrorRoles`) — synchronous edits the
//   worksheet and inspector call directly;
// - the double-import guard (`./importBatch`) — read synchronously by the
//   command layer's pre-flight check;
// - the empty-batch no-op below — a canceled picker settles with `[]` and must
//   stay a silent no-op that fetches nothing.
//
// ONLY THE FIRST IMPORT WAITS. Once the module is in, an action calls straight
// through on its own tick, so the batch's pendingOps entry and the
// double-import guard are set synchronously with the call, exactly as before
// this seam. During the first import's chunk fetch the guard is not yet set,
// but two imports started in that window still cannot both run: their
// continuations run in call order, and the first sets the guard synchronously
// before the second checks it.
//
// HISTORY BATCHES. The chunk fetch is an `await` BEFORE the import's first
// mutation. `withHistoryBatch` (store/history.ts) captures its pre-batch
// snapshot lazily at the first fold, so a foreign edit landing in this gap is
// handled exactly like one landing during the import's own network round trip.
// The invariant that doc names — no real await AFTER the last fold — is
// untouched: everything after the load is the unchanged real action.
//
// FAILURE CONTRACT. A chunk that will not load settles the action with `[]`
// (it never rejects, exactly like the real one, which reports every per-file
// failure itself) and a status + danger toast saying nothing was imported —
// before anything was fetched or written. A rejected load is not cached; the
// next gesture refetches.
//
// NOTE: `store/importDatasets.ts` must stay free of static value importers
// reachable from the entry chunk; `src/architecture.test.ts`'s SEAMS list is
// the guard (the `import type` below erases).

import { plural } from "../lib/plural";
import type { ImportSlice } from "./importDatasets";
import { createErrorRolesActions } from "./importErrorRoles";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

export type { ImportPathsOptions, ImportSlice } from "./importDatasets";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;
type ImportCore = typeof import("./importDatasets");

let inflight: Promise<ImportCore> | null = null;
/** The resolved module, once it is in — see "ONLY THE FIRST IMPORT WAITS". */
let loaded: ImportCore | null = null;

/** The import module, fetched once per session. */
export function importCore(): Promise<ImportCore> {
  inflight ??= import("./importDatasets").then(
    (core) => (loaded = core),
    (e: unknown) => {
      inflight = null; // not cached on failure: the next gesture retries
      throw e;
    },
  );
  return inflight;
}

function loadFailed(get: SliceGet, count: number): (e: unknown) => string[] {
  return (e) => {
    const msg = `import failed — couldn't load the importer: ${e instanceof Error ? e.message : "error"}`;
    get().setStatus(msg);
    toast(`${msg} — nothing was imported (${count} file${plural(count)} skipped)`, "danger");
    return [];
  };
}

/** Run `act` against the real module: synchronously once it is loaded, after
 *  the fetch otherwise. An empty batch never fetches. */
function withCore(
  count: number,
  get: SliceGet,
  act: (core: ImportCore) => Promise<string[]>,
): Promise<string[]> {
  if (count === 0) return Promise.resolve([]);
  if (loaded) return act(loaded);
  return importCore().then(act, loadFailed(get, count));
}

export function createImportSlice(set: SliceSet, get: SliceGet): ImportSlice {
  return {
    ...createErrorRolesActions(set, get),
    importFiles: (files) =>
      withCore(files.length, get, (core) => core.createImportSlice(set, get).importFiles(files)),
    importPaths: (paths, opts) =>
      withCore(paths.length, get, (core) => core.createImportSlice(set, get).importPaths(paths, opts)),
  };
}

/** Test-only: forget the cached module (cold path / `vi.doMock`). */
export function resetImportCoreForTests(): void {
  inflight = null;
  loaded = null;
}
