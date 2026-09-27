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
// THE GUARD AND THE OP ARE CLAIMED HERE, SYNCHRONOUSLY, BEFORE THE CHUNK IS
// EVEN REQUESTED (review finding 1). Before this fix the guard was only ever
// set once the real module had loaded and its `runImport` actually started —
// so during a cold fetch, `isImportRunning()` read `false` the whole time,
// and a SEPARATE synchronous pre-flight check elsewhere (e.g.
// `commands/fileCommands.ts`'s `rejectIfImportRunning`, guarding "Import &
// append…") could see the guard as free, claim it itself, and start its OWN
// import — which then made the FIRST (earlier, already-in-flight) caller's
// `runImport` see the guard held and refuse itself once its chunk finally
// arrived, silently dropping whatever it was importing. Claiming both here,
// on the caller's own tick, closes that window: from the very first cold
// import onward, every OTHER guard reader sees it exactly as busy as it would
// have been before this seam existed. Once the chunk is in, ownership hands
// off to the real `runImport` (`bypassGuard`/`existingOpId` — see
// `store/importDatasets.ts`'s `InternalRunOptions`): it neither re-claims nor
// re-registers, just continues both and clears them itself when it finishes.
// Once `loaded` is set, a LATER call runs straight through on its own tick
// with no bypass at all — the guard and op it claims there are its own,
// exactly as before this fix.
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
// before anything was fetched or written, and the guard/op it claimed above
// are released. HONEST RETRY (review finding 3): a real browser caches a
// failed dynamic `import()` of the SAME chunk URL for the page's lifetime —
// no in-session gesture actually re-fetches it, unlike `vi.resetModules()` in
// a spec — so `../lib/onDemand.ts` is told `retryOnFailure: false` here, and
// the status/toast say so ("reload the app to retry") instead of promising a
// refetch that cannot happen. `resetImportCoreForTests()` is the explicit,
// honest stand-in for that reload.
//
// NOTE: `store/importDatasets.ts` must stay free of static value importers
// reachable from the entry chunk; `src/architecture.test.ts`'s SEAMS list is
// the guard (the `import type` below erases).

import { onDemand } from "../lib/onDemand";
import { plural } from "../lib/plural";
import type { ImportFilesOptions, ImportSlice } from "./importDatasets";
import { createErrorRolesActions } from "./importErrorRoles";
import { ALREADY_RUNNING_MSG, useImportBatch } from "./importBatch";
import { beginOp, endOp } from "./pendingOps";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

export type { ImportFilesOptions, ImportPathsOptions, ImportSlice } from "./importDatasets";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;
type ImportCore = typeof import("./importDatasets");

/** The resolved module, once it is in — see this file's header. */
let loaded: ImportCore | null = null;

const loader = onDemand<ImportCore>(
  () => import("./importDatasets").then((core) => (loaded = core)),
  { retryOnFailure: false }, // see this file's "FAILURE CONTRACT" doc
);

/** The import module, fetched once per session. */
export function importCore(): Promise<ImportCore> {
  return loader.core();
}

function loadFailed(get: SliceGet, count: number): (e: unknown) => string[] {
  return (e) => {
    const reason = e instanceof Error ? e.message : "error";
    const msg = `import failed — couldn't load the importer: ${reason} — reload the app to retry`;
    get().setStatus(msg);
    toast(`${msg} (${count} file${plural(count)} skipped)`, "danger");
    return [];
  };
}

/** Internal knobs a warm `act(core)` call never needs (the real `runImport`
 *  does its own full guard-claim + `beginOp` exactly as before this seam). A
 *  cold call passes both, handing off the guard/op it claimed synchronously
 *  below. Structurally identical for files/paths (`ImportFilesOptions` IS
 *  just these two fields — see `store/importDatasets.ts`), so one alias
 *  covers both `act` call sites below. */
type Handoff = ImportFilesOptions;

/** Run `act` against the real module: synchronously once it is loaded, after
 *  the fetch otherwise. An empty batch never fetches. On a COLD call, claims
 *  the double-import guard and begins a pendingOps entry synchronously,
 *  BEFORE awaiting the chunk (review findings 1/2), and hands both off to the
 *  real module once it arrives; a cancel during the fetch aborts before any
 *  upload starts. */
function withCore(
  count: number,
  get: SliceGet,
  act: (core: ImportCore, handoff?: Handoff) => Promise<string[]>,
): Promise<string[]> {
  if (count === 0) return Promise.resolve([]);
  if (loaded) return act(loaded);

  if (useImportBatch.getState().running) {
    get().setStatus(ALREADY_RUNNING_MSG);
    toast(ALREADY_RUNNING_MSG, "danger");
    return Promise.resolve([]);
  }
  useImportBatch.setState({ running: true });
  let cancelled = false;
  const opId = beginOp(`Loading the importer for ${count} file${plural(count)}…`, () => {
    cancelled = true; // logical cancel only — the chunk fetch itself cannot be aborted
  });

  const release = (): void => {
    endOp(opId);
    useImportBatch.setState({ running: false });
  };

  return importCore().then(
    (core) => {
      if (cancelled) {
        release(); // cancelled before the chunk resolved — no upload ever started
        return [];
      }
      return act(core, { bypassGuard: true, existingOpId: opId });
    },
    (e: unknown) => {
      release();
      return loadFailed(get, count)(e);
    },
  );
}

export function createImportSlice(set: SliceSet, get: SliceGet): ImportSlice {
  return {
    ...createErrorRolesActions(set, get),
    importFiles: (files, opts) =>
      withCore(files.length, get, (core, handoff) =>
        core.createImportSlice(set, get).importFiles(files, { ...opts, ...handoff }),
      ),
    importPaths: (paths, opts) =>
      withCore(paths.length, get, (core, handoff) =>
        core.createImportSlice(set, get).importPaths(paths, { ...opts, ...handoff }),
      ),
  };
}

/** Test-only: forget the cached module (cold path / `vi.doMock`) — the
 *  explicit stand-in for the reload a real failed-load recovery needs (see
 *  this file's "FAILURE CONTRACT" doc). */
export function resetImportCoreForTests(): void {
  loader.resetForTests();
  loaded = null;
}
