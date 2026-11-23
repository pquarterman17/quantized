// Proxies for slice actions whose bodies live in a lazily loaded module
// (bundle diet slice 32, `plans/BUNDLE_HEADROOM.md`).
//
// For a slice whose actions are only ever called from lazy chunks (the
// worksheet, a workshop), the eager store keeps one proxy per action and the
// bodies load on demand. Once the module has landed, a proxy is a plain
// synchronous call that returns the body's own value, so a warmed slice
// behaves exactly as before. Until then a call waits for the load and runs
// the body after it, in call order (every waiting call chains on ONE load
// promise); its return value is then a Promise nobody reads, so use this only
// for actions whose callers ignore the result, or already await it.
//
// FAILURE: a chunk that will not load is reported once through `onFail`
// (status line + danger toast at the call site), every call waiting on it is
// dropped without running, and the next call tries the load again.
import { onDemand } from "../lib/onDemand";

const warmers = new Set<() => Promise<void>>();

/** Test-only: load every lazy slice's bodies (`src/test/setup.ts` does this
 *  before each file, as the app does when the lazy surface that calls them
 *  mounts), so a spec that calls an action reads its effect synchronously. */
export const warmAllLazyActions = (): Promise<void> => Promise.all([...warmers].map((w) => w())).then(() => undefined);

export interface LazyActions<T, K extends keyof T> {
  actions: Pick<T, K>;
  /** Start (or join) the load. Resolves once the bodies are in, or the
   *  failure has been reported. */
  warm: () => Promise<void>;
  /** Test-only: forget the loaded bodies so a spec can exercise the cold path. */
  resetForTests: () => void;
}

export function lazyActions<T extends object, K extends keyof T>(
  keys: readonly K[],
  load: () => Promise<T>,
  onFail: (e: unknown) => void,
): LazyActions<T, K> {
  const body = onDemand(load);
  let impl: T | null = null;
  let loading: Promise<T | null> | null = null;
  const ready = (): Promise<T | null> =>
    (loading ??= body.core().then(
      (m) => (impl = m),
      (e: unknown) => {
        loading = null;
        onFail(e);
        return null;
      },
    ));
  const actions: Record<string, unknown> = {};
  for (const key of keys) {
    actions[key as string] = (...args: unknown[]) => {
      const run = (m: T) => (m[key] as (...a: unknown[]) => unknown)(...args);
      return impl ? run(impl) : ready().then((m) => (m ? run(m) : undefined));
    };
  }
  const warm = () => ready().then(() => undefined);
  warmers.add(warm);
  return {
    actions: actions as unknown as Pick<T, K>,
    warm,
    resetForTests: () => {
      impl = null;
      loading = null;
      body.resetForTests();
    },
  };
}
