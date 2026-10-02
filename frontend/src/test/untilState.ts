// Wait for a zustand store to reach a state, with no clock (docs/testing.md).
//
// `vi.waitFor(cb)` polls `cb` against a DEFAULT 1000 ms budget. A wait on a lazy
// `import()` or a mocked fetch chain needs no time at all when idle, but under a
// loaded full run a cold module transform or a stalled worker overran that budget
// (computedColumns.test.ts, 2026-10-02: the fitval refresh measured up to 1002 ms
// under load). `untilState` re-checks on every store write instead of on a timer,
// so it resolves on the very write that makes `check` pass. The test's own
// timeout (vite.config.ts `testTimeout`) is the only, loose, backstop.

interface StoreLike<S> {
  getState(): S;
  subscribe(listener: (state: S) => void): () => void;
}

/** Resolve once `check(state)` stops throwing. `check` is an `expect`-style
 *  assertion on the store's state; it runs now and after every store write. */
export function untilState<S>(store: StoreLike<S>, check: (state: S) => void): Promise<void> {
  const passes = (state: S): boolean => {
    try {
      check(state);
      return true;
    } catch {
      return false;
    }
  };
  if (passes(store.getState())) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (!passes(state)) return;
      unsubscribe();
      resolve();
    });
  });
}
