// P3.4 slice 4: staged plot-window hydration on workspace restore. Pure
// module tests for this store's queue/scheduler contract — the render-layer
// wiring (WindowContent.tsx's placeholder gate, WindowCanvas's focus/prune
// effects) is exercised indirectly by WindowCanvas.test.tsx, whose existing
// suite never calls `stageWorkspaceRestore` and still expects every window
// to mount a live uPlot instance immediately — the proof that staging only
// ever engages via an explicit call, never a heuristic on window count.
//
// requestAnimationFrame is stubbed to a manually-steppable queue (never
// fires on its own — jsdom has no paint loop), the same discipline
// PlotWindowFrame.test.tsx documents for its own rAF-throttled drag. Each
// `stepFrame()` call is exactly one "frame" of the drain.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";
import {
  beginStagedHydration,
  forceHydrate,
  isHydrated,
  pruneHydration,
  resetWindowHydrationForTests,
  stageWorkspaceRestore,
} from "./windowHydration";

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: null,
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

let frameQueue: FrameRequestCallback[] = [];

/** Run exactly the next queued animation frame (a no-op if none is queued —
 *  mirrors a real rAF chain that stops scheduling once the drain is done). */
function stepFrame(): void {
  const cb = frameQueue.shift();
  if (cb) cb(0);
}

beforeEach(() => {
  resetWindowHydrationForTests();
  frameQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameQueue.push(cb);
    return frameQueue.length;
  });
  // A real cancelAnimationFrame only cancels ITS OWN handle; this module
  // only ever has one outstanding frame at a time (drainOne re-schedules
  // only from inside its own callback), so clearing the whole stub queue is
  // an equivalent simplification for these tests.
  vi.stubGlobal("cancelAnimationFrame", () => {
    frameQueue = [];
  });
});

afterEach(() => {
  resetWindowHydrationForTests();
  vi.unstubAllGlobals();
});

describe("windowHydration — defaults (no heuristic, no count threshold)", () => {
  it("an id that was never staged always reads hydrated", () => {
    expect(isHydrated("never-staged")).toBe(true);
  });
});

describe("windowHydration — beginStagedHydration / drain order", () => {
  it("staged ids read unhydrated until their turn, draining one per frame in the given order", () => {
    beginStagedHydration(["a", "b", "c"]);
    expect(isHydrated("a")).toBe(false);
    expect(isHydrated("b")).toBe(false);
    expect(isHydrated("c")).toBe(false);
    expect(frameQueue).toHaveLength(1); // exactly one frame scheduled at a time

    stepFrame();
    expect(isHydrated("a")).toBe(true);
    expect(isHydrated("b")).toBe(false);
    expect(isHydrated("c")).toBe(false);

    stepFrame();
    expect(isHydrated("b")).toBe(true);
    expect(isHydrated("c")).toBe(false);

    stepFrame();
    expect(isHydrated("c")).toBe(true);
    expect(frameQueue).toHaveLength(0); // nothing left to schedule
  });

  it("an empty stage is a true no-op — no frame is ever scheduled", () => {
    beginStagedHydration([]);
    expect(frameQueue).toHaveLength(0);
  });

  it("a second begin call supersedes the first outright", () => {
    beginStagedHydration(["a", "b"]);
    beginStagedHydration(["x"]);
    expect(isHydrated("a")).toBe(true); // dropped, not "hydrated" via a drain turn
    expect(isHydrated("x")).toBe(false);
    stepFrame();
    expect(isHydrated("x")).toBe(true);
  });
});

describe("windowHydration — stageWorkspaceRestore", () => {
  it("excludes the active window — it's hydrated from the very first render", () => {
    const windows = [win({ id: "active", z: 3 }), win({ id: "bg1", z: 1 }), win({ id: "bg2", z: 2 })];
    stageWorkspaceRestore(windows, "active");
    expect(isHydrated("active")).toBe(true);
    expect(isHydrated("bg1")).toBe(false);
    expect(isHydrated("bg2")).toBe(false);
  });

  it("orders the rest by z DESCENDING — topmost/most-recently-raised drains first", () => {
    const windows = [win({ id: "low", z: 1 }), win({ id: "high", z: 5 }), win({ id: "mid", z: 3 })];
    stageWorkspaceRestore(windows, null);
    stepFrame();
    expect(isHydrated("high")).toBe(true);
    expect(isHydrated("mid")).toBe(false);
    expect(isHydrated("low")).toBe(false);
    stepFrame();
    expect(isHydrated("mid")).toBe(true);
    expect(isHydrated("low")).toBe(false);
  });

  it("never stages a window that already carries a cross-window link group", () => {
    const windows = [
      win({ id: "active", z: 1 }),
      win({ id: "linked", z: 2, linkGroup: 1 }),
      win({ id: "bg", z: 3 }),
    ];
    stageWorkspaceRestore(windows, "active");
    expect(isHydrated("linked")).toBe(true); // sync needs a live instance immediately
    expect(isHydrated("bg")).toBe(false);
  });

  it("small sessions feel unchanged: 2-3 windows drain within a couple of frames, no threshold gate", () => {
    const windows = [win({ id: "active" }), win({ id: "b" }), win({ id: "c" })];
    stageWorkspaceRestore(windows, "active");
    stepFrame();
    stepFrame();
    expect(isHydrated("b")).toBe(true);
    expect(isHydrated("c")).toBe(true);
  });
});

describe("windowHydration — forceHydrate (the interaction escape hatch)", () => {
  it("hydrates a still-pending id immediately and removes it from the drain queue", () => {
    beginStagedHydration(["a", "b", "c"]);
    forceHydrate("b");
    expect(isHydrated("b")).toBe(true);
    // "b" no longer occupies a drain slot — only "a" then "c" remain.
    stepFrame();
    expect(isHydrated("a")).toBe(true);
    expect(isHydrated("c")).toBe(false);
    stepFrame();
    expect(isHydrated("c")).toBe(true);
    expect(frameQueue).toHaveLength(0);
  });

  it("is a safe no-op for an id that was never staged", () => {
    expect(() => forceHydrate("whatever")).not.toThrow();
    expect(isHydrated("whatever")).toBe(true);
  });

  it("is sticky — a later unrelated restore never re-stages a forced id", () => {
    beginStagedHydration(["a"]);
    forceHydrate("a");
    beginStagedHydration(["x"]); // an unrelated later restore
    expect(isHydrated("a")).toBe(true);
  });
});

describe("windowHydration — pruneHydration (queue cancellation on window close)", () => {
  it("drops a closed window from staging so its drain slot isn't wasted", () => {
    beginStagedHydration(["a", "b", "c"]);
    pruneHydration(new Set(["a", "c"])); // "b" was closed mid-stage
    stepFrame();
    expect(isHydrated("a")).toBe(true);
    // "b" is gone entirely — the SECOND frame hydrates "c", not a dead slot.
    stepFrame();
    expect(isHydrated("c")).toBe(true);
    expect(frameQueue).toHaveLength(0);
  });

  it("is a no-op when nothing is pending", () => {
    expect(() => pruneHydration(new Set())).not.toThrow();
  });

  it("pruning everything leaves any already-scheduled frame harmless", () => {
    beginStagedHydration(["a", "b"]);
    pruneHydration(new Set());
    expect(isHydrated("a")).toBe(true);
    expect(isHydrated("b")).toBe(true);
    expect(() => stepFrame()).not.toThrow(); // the stale frame finds nothing left to drain
  });
});

describe("windowHydration — save-after-restore byte-equivalence", () => {
  afterEach(() => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "maximized" })],
      focusedWindowId: "w1",
      datasets: [],
      folders: [],
    });
  });

  it("engaging staged hydration never changes what a save serializes — placeholders are render-only", () => {
    useApp.getState().loadWorkspace({
      datasets: [],
      folders: [],
      plotWindows: [win({ id: "active", z: 2 }), win({ id: "bg1", z: 1 }), win({ id: "bg2", z: 3 })],
      focusedWindowId: "active",
    });
    const before = serializeWorkspace({ ...useApp.getState(), plotWindows: useApp.getState().windowsForSave() });

    stageWorkspaceRestore(useApp.getState().plotWindows, useApp.getState().focusedWindowId);
    expect(isHydrated("bg1")).toBe(false); // staging genuinely engaged — not a vacuous pass

    const after = serializeWorkspace({ ...useApp.getState(), plotWindows: useApp.getState().windowsForSave() });

    // `savedAt` is a wall-clock timestamp, the one field allowed to differ
    // (serializeWorkspace pretty-prints via `JSON.stringify(doc, null, 2)`,
    // so the key/value separator is ": ", not ":").
    const strip = (json: string) => json.replace(/"savedAt": "[^"]*"/, '"savedAt": ""');
    expect(strip(after)).toBe(strip(before));
  });
});
