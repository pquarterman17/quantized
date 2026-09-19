// UX-003: a drop-in replacement for React's `lazy()` that adds a per-region
// error boundary AND a retry that actually recovers.
//
// React memoizes the promise a `lazy()` loader returns on the object
// `lazy()` itself returns, not per Fiber/render. Once that promise rejects
// (a failed chunk fetch), every future render of that SAME lazy component
// re-throws the identical cached rejection forever — a naive "catch + button
// that re-renders" boundary looks like it works but can never actually
// recover. `lazyRegion(load, label)` is used exactly like `lazy(load)` at
// the call site: ONE `lazy()` object is built at call time (same as plain
// `lazy()` — every mount of this seam shares it, resolves once, stays
// resolved, exactly the memoization every other seam in this app already
// relies on) and only a RETRY swaps in a brand-new `lazy()` (a fresh,
// unrejected payload object) — the only way to defeat the cache. Verified
// with a loader that rejects once then resolves (src/lib/lazyRegion.test.tsx).
//
// One `Catch` class is shared by every call site (this module, plus the
// `lazyPanel` factory in AppOverlays.tsx, which wraps this too) so the
// eager cost is paid once, not once per seam — see CLAUDE.md's bundle
// headroom notes on why that matters here.
import { Component, lazy, Suspense, useState } from "react";
import type { ComponentType, ReactNode } from "react";

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
  static getDerivedStateFromError(): CatchState {
    return { failed: true };
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
  // Module-scoped, like a plain `const X = lazy(load)` — computed once, and
  // every mount of this seam reads the SAME object until a retry swaps it.
  // That keeps the everyday (never-fails) case identical to `lazy()`: the
  // first mount anywhere pays one chunk fetch, every later mount (a second
  // window, a reopened panel, …) is already resolved and synchronous. Only
  // `retry()` below — an event handler, never render — reassigns it.
  let current = lazy(load);
  return function Region(props: P) {
    const [attempt, setAttempt] = useState(0);
    const retry = (): void => {
      current = lazy(load);
      setAttempt((a) => a + 1);
    };
    const Comp = current;
    return (
      <Catch key={attempt} label={label} onRetry={retry}>
        <Suspense fallback={fallback}>
          <Comp {...props} />
        </Suspense>
      </Catch>
    );
  };
}
