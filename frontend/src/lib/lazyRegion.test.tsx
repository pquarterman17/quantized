// UX-003 regression: a failed lazy() chunk fetch must not take the rest of
// the app down with it, must be visible, and a retry must genuinely recover
// — not just re-render the same cached rejection (React memoizes a lazy()
// loader's rejected promise on the object lazy() returns, so a naive
// "catch + re-render" boundary looks like it works but can never actually
// recover; see this module's header).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { ComponentType } from "react";

import { lazyRegion } from "./lazyRegion";

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
});
