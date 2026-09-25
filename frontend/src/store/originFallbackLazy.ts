// On-demand loader for the Origin graph-recovery fallbacks (bundle headroom
// slice 9, `plans/BUNDLE_HEADROOM.md`) — the `store/plotRecipeApplyLazy.ts`
// shape, applied to a whole slice like `store/reimportLazy.ts`.
//
// `store/originFallback.ts` (with `lib/originSources.ts`, which only it
// reaches eagerly) implements "Open Origin source" and "Remake in Graph
// Builder" (#50). Both actions were ALREADY `async` (each awaits
// `resolveDatasets` before touching the store), so this composes an
// identically-typed slice whose two actions fetch the real ones on first use;
// no public signature changes. The slice's one state field and its
// synchronous clearer stay here, eager, because the worksheet reads the seed
// on render. The recovery logic itself is NOT touched — the real slice runs
// unchanged once loaded.
//
// FAILURE CONTRACT. A chunk that will not load settles the action with a
// danger toast, before anything was resolved or written — the same channel
// (and the same "Couldn't ..." phrasing) the real actions use for a failed
// source-book fetch. A rejected load is not cached; the next click refetches.
//
// NOTE: `store/originFallback.ts` must stay free of static value importers
// reachable from the entry chunk; `src/architecture.test.ts`'s SEAMS list is
// the guard (the `import type` below erases).

import type { OriginFallbackSlice } from "./originFallback";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

export type { OriginFallbackSlice } from "./originFallback";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;
type OriginFallbackCore = typeof import("./originFallback");

let inflight: Promise<OriginFallbackCore> | null = null;

/** The Origin fallback module, fetched once per session. */
export function originFallbackCore(): Promise<OriginFallbackCore> {
  inflight ??= import("./originFallback").catch((e: unknown) => {
    inflight = null; // not cached on failure: the next gesture retries
    throw e;
  });
  return inflight;
}

function loadFailed(what: string): (e: unknown) => void {
  return (e) => toast(`Couldn't ${what} — ${e instanceof Error ? e.message : "load failed"}`, "danger");
}

export function createOriginFallbackSlice(set: SliceSet, get: SliceGet): OriginFallbackSlice {
  return {
    originWorksheetSeed: null,
    clearOriginWorksheetSeed: () => set({ originWorksheetSeed: null }),
    openOriginFigureSource: (figureId, datasetId, opts) =>
      originFallbackCore().then(
        (core) => core.createOriginFallbackSlice(set, get).openOriginFigureSource(figureId, datasetId, opts),
        loadFailed("open Origin source workbook"),
      ),
    remakeOriginFigure: (figureId) =>
      originFallbackCore().then(
        (core) => core.createOriginFallbackSlice(set, get).remakeOriginFigure(figureId),
        loadFailed("seed Graph Builder"),
      ),
  };
}

/** Test-only: forget the cached promise (cold path / `vi.doMock`). */
export function resetOriginFallbackCoreForTests(): void {
  inflight = null;
}
