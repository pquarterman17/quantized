// On-demand loader for the Origin-apply half of the figure library (bundle
// headroom slice 1, `plans/BUNDLE_HEADROOM.md`).
//
// `lib/originFigureSelection` + `lib/originSpatialPanels` (and, through them,
// `lib/originPanels`) are only ever reached when a user actually APPLIES an
// imported Origin figure — never at first paint. Importing them dynamically
// keeps them, and their transitive weight, out of the entry chunk.
//
// The loaded namespace is cached in a module-level slot so that only the FIRST
// apply of a session is deferred: once `originApplyLibs()` returns non-null,
// `useApp.applyOriginFigure` runs its whole body synchronously, exactly as it
// did before the split. That is the reason this file caches the modules rather
// than awaiting `import()` at each call site: it lets the apply body keep its
// existing synchronous `set()` sequencing — one history/macro entry per apply,
// covered by store/useApp.test.ts — instead of being rewritten as an async
// function whose awaits could split one user action into several.
//
// NOTE: these two modules must stay free of static importers reachable from
// the entry chunk, or the bundler folds them straight back into it.

type SelectionLib = typeof import("../lib/originFigureSelection");
type SpatialLib = typeof import("../lib/originSpatialPanels");

/** Everything `applyOriginFigure` needs beyond the eager `lib/originFigures`. */
export type OriginApplyLibs = SelectionLib & SpatialLib;

let cached: OriginApplyLibs | null = null;
let inflight: Promise<OriginApplyLibs> | null = null;

/** The loaded modules, or null when they have not been fetched yet. Callers
 *  that get null must go through `loadOriginApplyLibs()` and re-enter. */
export function originApplyLibs(): OriginApplyLibs | null {
  return cached;
}

/** Load (once) and cache the Origin-apply modules. Concurrent callers share
 *  one in-flight request; a failed load is NOT cached, so a later apply
 *  retries instead of being permanently broken by one transient chunk fetch
 *  failure. */
export function loadOriginApplyLibs(): Promise<OriginApplyLibs> {
  if (cached) return Promise.resolve(cached);
  inflight ??= Promise.all([
    import("../lib/originFigureSelection"),
    import("../lib/originSpatialPanels"),
  ])
    .then(([selection, spatial]) => {
      cached = { ...selection, ...spatial };
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test-only: forget the cached namespace so a spec can exercise the COLD
 *  (deferred) apply path. Production code never calls this (same shape as
 *  `store/windowHydration.ts`'s `resetWindowHydrationForTests`). */
export function resetOriginApplyLibsForTests(): void {
  cached = null;
  inflight = null;
}
