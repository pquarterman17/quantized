// UX-003 regression: a failed lazy() chunk fetch must not take the rest of
// the app down with it, must be visible, and a retry must genuinely recover
// — not just re-render the same cached rejection (React memoizes a lazy()
// loader's rejected promise on the object lazy() returns, so a naive
// "catch + re-render" boundary looks like it works but can never actually
// recover; see this module's header).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { useState, useEffect, Component } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";

import { lazyRegion } from "./lazyRegion";

/** A minimal real error boundary, standing in for whatever boundary sits
 *  ABOVE a lazyRegion seam in the real app (or the crash-to-console default
 *  if there is none) — used to prove a genuine render error propagates past
 *  lazyRegion's own boundary instead of being swallowed and mislabeled. */
class OuterProbe extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  render(): ReactNode {
    if (this.state.message) return <div>OUTER CAUGHT: {this.state.message}</div>;
    return this.props.children;
  }
}

// React logs the caught error to console.error even though the boundary
// handles it — expected noise, not a failure signal for these tests.
let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

/** A loader that rejects on its first N calls, then resolves. */
function flakyLoader(failuresBeforeSuccess: number): {
  load: () => Promise<{ default: ComponentType }>;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    load: () => {
      calls += 1;
      if (calls <= failuresBeforeSuccess) return Promise.reject(new Error("chunk fetch failed"));
      return Promise.resolve({ default: () => <div>Loaded content</div> });
    },
  };
}

describe("lazyRegion", () => {
  it("keeps the surrounding tree mounted and surfaces the failure (never a silent blank region)", async () => {
    const { load } = flakyLoader(Infinity);
    const Region = lazyRegion(load, "Widget");

    render(
      <div>
        <div data-testid="sibling">still here</div>
        <Region />
      </div>,
    );

    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
    // The rest of the tree — a stand-in for "the rest of the app" — survives.
    expect(screen.getByTestId("sibling")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("recovers on retry after a transient failure — the cached-rejection trap", async () => {
    const { load, calls } = flakyLoader(1);
    const Region = lazyRegion(load, "Widget");

    render(<Region />);
    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
    expect(calls()).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    // A naive boundary that just re-renders the SAME lazy() object would
    // re-throw the identical cached rejection here and never reach this
    // line. Reaching it, with the loader having been invoked a SECOND time,
    // is the proof retry actually re-fetches rather than replaying the
    // memoized failure.
    expect(await screen.findByText("Loaded content")).toBeInTheDocument();
    expect(calls()).toBe(2);
    expect(screen.queryByText("⚠ Widget failed to load.")).not.toBeInTheDocument();
  });

  it("a second, unrelated retry after a second failure still recovers (not a one-shot fix)", async () => {
    const { load, calls } = flakyLoader(2);
    const Region = lazyRegion(load, "Widget");

    render(<Region />);
    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });
    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
    expect(calls()).toBe(2);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });
    expect(await screen.findByText("Loaded content")).toBeInTheDocument();
    expect(calls()).toBe(3);
  });

  it("passes props through to the loaded component once it succeeds", async () => {
    const load = (): Promise<{ default: ComponentType<{ label: string }> }> =>
      Promise.resolve({ default: ({ label }) => <div>{label}</div> });
    const Region = lazyRegion(load, "Widget");

    render(<Region label="hello" />);
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });

  it("a healthy sibling region is unaffected by a failing one (per-region, not one shared boundary)", async () => {
    const failing = flakyLoader(Infinity);
    const FailingRegion = lazyRegion(failing.load, "Broken");
    const okLoad = (): Promise<{ default: ComponentType }> =>
      Promise.resolve({ default: () => <div>OK region</div> });
    const OkRegion = lazyRegion(okLoad, "Fine");

    render(
      <div>
        <FailingRegion />
        <OkRegion />
      </div>,
    );

    expect(await screen.findByText("⚠ Broken failed to load.")).toBeInTheDocument();
    expect(await screen.findByText("OK region")).toBeInTheDocument();
  });

  // Review finding #1 (HIGH): the boundary used to catch every descendant
  // error, not just a load failure, and show the identical "failed to
  // load" message — turning a real bug into a wrong, unactionable
  // diagnosis. Only the loader's own rejection may show that UI.
  it("does NOT show the load-failure UI for a render error from a successfully-loaded component — it propagates", async () => {
    const Boom = (): never => {
      throw new Error("real bug, nothing to do with loading");
    };
    const load = (): Promise<{ default: ComponentType }> => Promise.resolve({ default: Boom });
    const Region = lazyRegion(load, "Widget");

    render(
      <OuterProbe>
        <Region />
      </OuterProbe>,
    );

    // Caught by the boundary ABOVE lazyRegion — proof it was re-thrown, not
    // swallowed here — and never mislabeled as a load failure.
    expect(await screen.findByText("OUTER CAUGHT: real bug, nothing to do with loading")).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("a load failure (the loader's own rejection) still shows the retry UI, unlike a render error", async () => {
    const load = (): Promise<{ default: ComponentType }> => Promise.reject(new Error("chunk fetch failed"));
    const Region = lazyRegion(load, "Widget");

    render(
      <OuterProbe>
        <Region />
      </OuterProbe>,
    );

    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
    expect(screen.queryByText(/OUTER CAUGHT/)).not.toBeInTheDocument();
  });

  // Review finding #2 (HIGH): a module-scoped lazy() meant every mounted
  // instance of a seam shared ONE lazy() object, so retrying instance A
  // handed instance B a brand-new component TYPE, silently remounting B
  // (destroying its state) even though B never failed and nobody asked for
  // it to be rebuilt. Each instance must own its own.
  it("retrying one mounted instance does not remount or reset a sibling instance of the SAME seam", async () => {
    let loadCalls = 0;
    const mountsB: number[] = [];
    const Loaded = ({ id }: { id: string }): ReactElement => {
      const [clicks, setClicks] = useState(0);
      useEffect(() => {
        if (id === "B") mountsB.push(loadCalls);
      }, [id]);
      return (
        <div>
          <span>loaded {id}</span>
          <button onClick={() => setClicks((c) => c + 1)}>bump {id}</button>
          <span>{`clicks-${id}:${clicks}`}</span>
        </div>
      );
    };
    // First load() call ever (A's initial mount, which renders first) fails;
    // every later call (B's initial mount, then A's retry) succeeds.
    const load = (): Promise<{ default: ComponentType<{ id: string }> }> => {
      loadCalls += 1;
      if (loadCalls === 1) return Promise.reject(new Error("chunk fetch failed"));
      return Promise.resolve({ default: Loaded });
    };
    const Shared = lazyRegion(load, "Shared");

    render(
      <div>
        <Shared id="A" />
        <Shared id="B" />
      </div>,
    );

    expect(await screen.findByText("⚠ Shared failed to load.")).toBeInTheDocument();
    expect(await screen.findByText("loaded B")).toBeInTheDocument();
    expect(mountsB).toEqual([2]); // B's own (only) load call

    fireEvent.click(screen.getByRole("button", { name: "bump B" }));
    expect(screen.getByText("clicks-B:1")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });
    expect(await screen.findByText("loaded A")).toBeInTheDocument();

    // B is untouched by A's retry: no second mount, local state intact.
    expect(mountsB).toEqual([2]);
    expect(screen.getByText("clicks-B:1")).toBeInTheDocument();
  });

  // Review finding #3 (MED): fixing #2 per-instance should make a failed
  // region recover on a plain unmount+remount (a fresh instance is a fresh
  // lazy(), never the old rejected one) without needing Retry at all.
  it("a fresh mount of a previously-failed seam is not stuck on the old rejection", async () => {
    let loadCalls = 0;
    const load = (): Promise<{ default: ComponentType }> => {
      loadCalls += 1;
      if (loadCalls === 1) return Promise.reject(new Error("chunk fetch failed"));
      return Promise.resolve({ default: () => <div>Loaded content</div> });
    };
    const Region = lazyRegion(load, "Widget");

    const { unmount } = render(<Region />);
    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
    unmount();

    render(<Region />);
    expect(await screen.findByText("Loaded content")).toBeInTheDocument();
    expect(loadCalls).toBe(2);
  });

  // Review finding #2's cost claim, measured rather than asserted: N
  // simultaneous per-instance mounts of one seam all settle within the SAME
  // small, fixed number of microtask flushes — not a growing number
  // proportional to N, which is what N serialized re-fetches would need.
  it("N simultaneous mounts of the same seam all resolve within one fixed microtask batch (cheap, not serialized)", async () => {
    let loadCalls = 0;
    const load = (): Promise<{ default: ComponentType }> => {
      loadCalls += 1;
      return Promise.resolve().then(() => ({ default: () => <div>ok</div> }));
    };
    const Shared = lazyRegion(load, "Shared");

    render(
      <div>
        <Shared />
        <Shared />
        <Shared />
        <Shared />
        <Shared />
      </div>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText("ok")).toHaveLength(5);
    expect(loadCalls).toBe(5); // one call per instance, none blocked on another
  });

  // Review round 2, finding #2 (LOW): tagging used to mutate the caught
  // rejection (a Symbol property write), which throws on a frozen/
  // non-extensible object — losing the tag and falling through to the
  // blank-screen bug this file exists to fix.
  it("still shows the retry UI for a load failure that cannot be mutated (frozen rejection)", async () => {
    const load = (): Promise<{ default: ComponentType }> =>
      Promise.reject(Object.freeze(new Error("chunk fetch failed")));
    const Region = lazyRegion(load, "Widget");

    render(<Region />);
    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
  });

  // Review round 2, finding #3 (LOW): a loader that throws SYNCHRONOUSLY
  // (rather than returning a rejected promise) must still be tagged as a
  // load failure, not escape as an unhandled throw. Not reachable through
  // any of today's 30+ call sites (every one is `() => import(...)`, which
  // can only reject) — defensive for a future loader shape.
  it("still shows the retry UI for a loader that throws synchronously", async () => {
    const load = (): Promise<{ default: ComponentType }> => {
      throw new Error("loader threw synchronously");
    };
    const Region = lazyRegion(load, "Widget");

    render(<Region />);
    expect(await screen.findByText("⚠ Widget failed to load.")).toBeInTheDocument();
  });
});
