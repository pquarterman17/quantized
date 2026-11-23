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
// FAILURE (fail closed): a chunk that will not load is reported once through
// `onFail("warm")` and every call that was waiting on it is dropped without
// running. From then on a COLD call is REFUSED: it never queues, so it can
// never apply later (callers read an action's effect synchronously: a
// history-mark check after setCellBlock, growAndSetCell's two steps, a paste
// computed against the sheet as it stands). The first refusal of the failure
// episode is reported through `onFail("refused")`; later ones are silent. Each
// refusal kicks a background reload that only WARMS (applies nothing, reports
// nothing); once it lands the slice is synchronous again and the episode ends.
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
  onFail: (e: unknown, kind: "warm" | "refused") => void,
): LazyActions<T, K> {
  const body = onDemand(load);
  let impl: T | null = null;
  let loading: Promise<T | null> | null = null;
  // `failed` spans a whole failure episode: from the first failed load until a
  // load lands. `refusedReported` keeps the refusals to one report per episode.
  let failed = false;
  let refusedReported = false;
  const ready = (report: boolean): Promise<T | null> =>
    (loading ??= body.core().then(
      (m) => {
        failed = false;
        refusedReported = false;
        return (impl = m);
      },
      (e: unknown) => {
        loading = null;
        const first = !failed;
        failed = true;
        if (report && first) onFail(e, "warm");
        return null;
      },
    ));
  const actions: Record<string, unknown> = {};
  for (const key of keys) {
    actions[key as string] = (...args: unknown[]) => {
      if (impl) return (impl[key] as (...a: unknown[]) => unknown)(...args);
      if (failed) {
        // Refuse: capture nothing (args can be a 1M-row array), apply nothing.
        if (!refusedReported) {
          refusedReported = true;
          onFail(null, "refused");
        }
        void ready(false);
        return undefined;
      }
      return ready(true).then((m) => (m ? (m[key] as (...a: unknown[]) => unknown)(...args) : undefined));
    };
  }
  const warm = () => ready(true).then(() => undefined);
  warmers.add(warm);
  return {
    actions: actions as unknown as Pick<T, K>,
    warm,
    resetForTests: () => {
      impl = null;
      loading = null;
      failed = false;
      refusedReported = false;
      body.resetForTests();
    },
  };
}
