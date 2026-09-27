// Shared on-demand dynamic-import loader (bundle headroom, `plans/
// BUNDLE_HEADROOM.md`) — the `inflight ??= import(...).catch(e => {inflight
// = null; throw e;})` + `resetXForTests` boilerplate that was copied, once per
// seam, across `store/reimportLazy.ts`, `store/workspaceIOLazy.ts`,
// `store/originFallbackLazy.ts`, `store/plotRecipeApplyLazy.ts` and
// `store/importDatasetsLazy.ts`. This is EAGER (every one of those seams is
// reached from the entry chunk), so it stays intentionally tiny — no
// reporting, no dedup, just the cached-promise mechanics each seam's own
// `.then(act, onFail)` call sites already build their own behavior on top of.
//
// RETRY-ON-FAILURE, opt-out only. Four of the five seams' failure is a
// transient library-chunk fetch that a later gesture safely retries (and each
// has its own test proving that with `vi.doUnmock` alone — see
// `store/plotRecipeApplyLibs.test.ts`'s header for why that is NOT the same
// thing as `vi.resetModules()`). Default `true` keeps that behavior exactly.
//
// `store/importDatasetsLazy.ts` passes `retryOnFailure: false`: a real
// browser caches a failed dynamic `import()` of the SAME chunk URL for the
// page's lifetime (measured; unlike `vi.resetModules()`, no in-session
// gesture actually re-fetches it), so silently nulling the slot there bought
// nothing but a false "the next gesture retries" promise — see that module's
// own doc and `plans/BUNDLE_HEADROOM.md` slice 10 for the incident.
// `resetForTests()` is the explicit, honest equivalent of what a real reload
// gives back.

export interface OnDemand<M> {
  /** The module, fetched at most once (since construction or the last
   *  `resetForTests()`); concurrent and later callers share the one
   *  in-flight/settled promise. */
  core(): Promise<M>;
  /** Test-only: forget the cached promise, so the next `core()` call
   *  genuinely re-`import()`s (`vi.doMock` / `vi.resetModules()`). */
  resetForTests(): void;
}

export interface OnDemandOptions {
  /** Whether a failed load clears the cached slot so a LATER call genuinely
   *  retries. Default `true`. Pass `false` when a failure is not something an
   *  in-session gesture can undo — see this file's header. */
  retryOnFailure?: boolean;
}

export function onDemand<M>(load: () => Promise<M>, opts: OnDemandOptions = {}): OnDemand<M> {
  const retryOnFailure = opts.retryOnFailure ?? true;
  let inflight: Promise<M> | null = null;

  function core(): Promise<M> {
    if (!inflight) {
      const attempt = load();
      inflight = retryOnFailure
        ? attempt.catch((e: unknown) => {
            inflight = null;
            throw e;
          })
        : attempt;
    }
    return inflight;
  }

  function resetForTests(): void {
    inflight = null;
  }

  return { core, resetForTests };
}
