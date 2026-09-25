// On-demand loader for single-dataset re-import (bundle headroom slice 9,
// `plans/BUNDLE_HEADROOM.md`) — the `store/plotRecipeApplyLazy.ts` shape.
//
// `store/reimport.ts` (with `lib/reimport.ts` and `lib/dependencyImpact.ts`,
// which only it reaches eagerly) is the whole "Re-import from source"
// gesture. Its slice was composed straight into `useApp.ts`, so it was a
// permanent startup cost for an action that only ever runs when the user asks
// for it. The one action, `reimportDataset`, was ALREADY `async` (it probes
// the source, may ask a confirm, and fetches), so its public signature does
// not change: this module composes an identically-typed slice whose action
// fetches the real one on first use. Slice 3 measured this seam as a LOSS
// (+1,451 B) — with Vite's full preload lists in place; slice 8's pruning
// removed that tax, and it now measures as a win (see slice 9's table).
//
// FAILURE CONTRACT. A chunk that will not load settles the action (it never
// rejects, exactly like the real one, whose own try/catch reports every
// failure) with the same status + danger toast shape a failed re-import
// always had, before anything was read or written — the dataset is provably
// unchanged. A rejected load is not cached; the next gesture refetches.
//
// NOTE: `store/reimport.ts` must stay free of static value importers
// reachable from the entry chunk; `src/architecture.test.ts`'s SEAMS list is
// the guard (the `import type` below erases).

import type { ReimportSlice } from "./reimport";
import { toast } from "./toasts";

export type { ReimportSlice } from "./reimport";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;
type ReimportCore = typeof import("./reimport");

let inflight: Promise<ReimportCore> | null = null;

/** The re-import module, fetched once per session. */
export function reimportCore(): Promise<ReimportCore> {
  inflight ??= import("./reimport").catch((e: unknown) => {
    inflight = null; // not cached on failure: the next gesture retries
    throw e;
  });
  return inflight;
}

export function createReimportSlice(set: SliceSet, get: SliceGet): ReimportSlice {
  return {
    reimportDataset: (id) =>
      reimportCore().then(
        (core) => core.createReimportSlice(set, get).reimportDataset(id),
        (e: unknown) => {
          const name = get().datasets.find((d) => d.id === id)?.name ?? id;
          const msg = `couldn't load re-import: ${e instanceof Error ? e.message : "error"}`;
          get().setStatus(`re-import failed: ${msg}`);
          toast(`re-import "${name}" failed: ${msg} — the dataset is unchanged`, "danger");
        },
      ),
  };
}

/** Test-only: forget the cached promise (cold path / `vi.doMock`). */
export function resetReimportCoreForTests(): void {
  inflight = null;
}
