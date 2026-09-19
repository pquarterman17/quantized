// UX-003: a drop-in replacement for React's `lazy()` that adds a per-region
// error boundary AND a retry that actually recovers.
//
// React memoizes the promise a `lazy()` loader returns on the object
// `lazy()` itself returns, not per Fiber/render. Once that promise rejects
// (a failed chunk fetch), every future render of that SAME lazy component
// re-throws the identical cached rejection forever — a naive "catch + button
// that re-renders" boundary looks like it works but can never actually
// recover. `lazyRegion(load, label)` is used exactly like `lazy(load)` at
// the call site. Verified with a loader that rejects once then resolves
// (src/lib/lazyRegion.test.tsx).
//
// Two properties a first cut of this file got wrong (found by review):
//
// 1. PER-INSTANCE retry, not module-scoped. Each *mounted* Region owns its
//    own retryable `lazy()` (a `useState` cell, set once per mount via the
//    lazy-initializer form); retry replaces only THAT instance's. Two
//    on-screen mounts of the SAME seam (e.g. two background plot windows)
//    must never share one mutable "current lazy" — a shared one means
//    retrying window A's failure hands window B a brand-new component TYPE
//    mid-session, remounting it (losing its uPlot instance, zoom/pan, local
//    state) for no reason B asked for (verified: a sibling's mount count
//    and local state are unchanged by another instance's retry). This also
//    fixes "a failed region never recovers on a plain remount" for free: an
//    unmount+remount is a brand new instance, hence a brand new `lazy()`,
//    hence not the old rejected one.
//
//    A mount is not, however, required to pay its own chunk fetch: `resolved`
//    below is a plain module-scoped cache of the last SUCCESSFULLY resolved
//    component (never written on failure), consulted only inside a fresh
//    instance's OWN initializer — never re-read by an already-mounted
//    instance later, so it cannot un-do point 1 above. This keeps the
//    common (never-fails) case byte- and behavior-identical to plain
//    `lazy()`: once any instance has loaded a seam, every later mount of it
//    renders synchronously from the cache instead of re-fetching, exactly
//    like `lazy()`'s own permanent memoization of a SUCCESS (only a
//    rejection must never be memoized past its own instance).
//
// 2. LOAD failures only. `getDerivedStateFromError` used to catch every
//    error thrown anywhere in the subtree — including a genuine bug in an
//    already-successfully-loaded component's own render — and mislabel it
//    "failed to load", which is worse than the blank screen this was meant
//    to fix: it hides the real error behind a wrong, unactionable diagnosis.
//    Only the loader's OWN failure is wrapped as a `LoadFailure` (below,
//    never by mutating the caught value — a frozen/non-extensible rejection
//    would throw on a property write and lose the tag); the boundary
//    re-throws anything else from `getDerivedStateFromError`, which hands
//    it to the next boundary up (or lets it crash), exactly as if this
//    boundary were not here.
import { Component, lazy, Suspense, useState } from "react";
import type { ComponentType, LazyExoticComponent, ReactNode } from "react";

/** Marks "the loader's own promise rejected" without touching the rejected
 *  value itself — mutating a caught error (a `Symbol` property write) would
 *  throw on a frozen/non-extensible one (e.g. `Object.freeze(new Error())`),
 *  losing the tag and falling through to the blank-screen bug this file
 *  exists to fix. Wrapping instead means tagging can never fail; the
 *  original value survives on `.cause` for diagnostics. */
class LoadFailure extends Error {
  constructor(cause: unknown) {
    super("lazyRegion: chunk failed to load", { cause });
    this.name = "LoadFailure";
  }
}

/** Wraps a loader so ONLY its own failure — sync throw or async rejection —
 *  becomes a `LoadFailure`, the exact value `lazy()` re-throws into the
 *  boundary. A later error thrown by the loaded component's own render is a
 *  different, un-wrapped value. Every call site here is `() => import(...)`,
 *  which can only reject, never throw synchronously — the try/catch is
 *  defensive for a future loader shape that might. */
function taggedLoader<P>(
  load: () => Promise<{ default: ComponentType<P> }>,
): () => Promise<{ default: ComponentType<P> }> {
  return () => {
    try {
      return load().catch((err: unknown) => {
        throw new LoadFailure(err);
      });
    } catch (err) {
      return Promise.reject(new LoadFailure(err));
    }
  };
}

function isLoadFailure(error: unknown): error is LoadFailure {
  return error instanceof LoadFailure;
}

interface CatchProps {
  label: string;
  onRetry: () => void;
  children: ReactNode;
}
interface CatchState {
  failed: boolean;
}

class Catch extends Component<CatchProps, CatchState> {
  state: CatchState = { failed: false };
  static getDerivedStateFromError(error: unknown): CatchState {
    // Not a load failure — a real bug elsewhere in this subtree. Don't
    // mislabel it: re-throwing from here hands it to the next boundary up
    // (or crashes), exactly as if lazyRegion had never wrapped this seam.
    if (!isLoadFailure(error)) throw error;
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    // The one diagnostic this boundary owes: which region failed, and why.
    // `error` is always a LoadFailure here (getDerivedStateFromError
    // re-throws anything else before this runs) — log its `.cause`, the
    // original rejection, not the wrapper's own generic message.
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    console.error(`[lazyRegion] "${this.props.label}" chunk failed to load`, cause);
  }
  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="qzk-lazy-fail" role="alert">
          <span>⚠ {this.props.label} failed to load.</span>
          <button type="button" onClick={this.props.onRetry}>
            ↻ Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** `lazy(load)` plus a boundary: `label` names the region in the fallback
 *  ("Library failed to load."), `fallback` is the Suspense placeholder
 *  while the chunk is in flight (default none — these seams resolve in a
 *  frame or two on localhost). */
export function lazyRegion<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
  fallback: ReactNode = null,
): ComponentType<P> {
  const taggedLoad = taggedLoader(load);
  // Written only by a SUCCESSFUL resolution, read only by a fresh mount's
  // own initializer (see point 1 above) — never by an already-mounted
  // instance, and never set on a rejection, so a mount that follows a
  // failure still gets its own real attempt.
  let resolved: ComponentType<P> | null = null;
  const freshLazy = (): LazyExoticComponent<ComponentType<P>> =>
    lazy(() =>
      taggedLoad().then((mod) => {
        resolved = mod.default;
        return mod;
      }),
    );

  return function Region(props: P) {
    // Lazy-initializer form: runs ONCE for this mounted instance, not on
    // every render and not shared with any other instance of this seam.
    const [Comp, setComp] = useState<ComponentType<P> | LazyExoticComponent<ComponentType<P>>>(
      () => resolved ?? freshLazy(),
    );
    const [attempt, setAttempt] = useState(0);
    const retry = (): void => {
      setComp(freshLazy());
      setAttempt((a) => a + 1);
    };
    return (
      <Catch key={attempt} label={label} onRetry={retry}>
        <Suspense fallback={fallback}>
          <Comp {...props} />
        </Suspense>
      </Catch>
    );
  };
}
