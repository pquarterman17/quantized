// Load-invariant regression for the O(datasets x rows) `rowStateKey` string
// PanelOverlayWindow used to build on EVERY render (see the file's header
// comment on `useOverlaySignature`). `PanelPlotWindow`'s `resolved` array is a
// fresh `.map().filter()` result on every one of ITS renders, so a naive
// `datasets` identity in the useMemo deps never gated anything either — this
// asserts BOTH: an unrelated re-render (same dataset objects, new outer
// array) does NOT re-run `droppedRows`, and an actual row-state change DOES.
//
// Real uPlot needs a browser canvas/layout engine neither jsdom nor this test
// cares about — mocked to a lightweight recorder (the WindowCanvas.test.tsx /
// PanelPlotWindow.test.tsx pattern).

import { render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import PanelOverlayWindow from "./PanelOverlayWindow";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: unknown; data: unknown }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: unknown, data: unknown) {
      created.push({ opts, data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

// `droppedRows` itself can't be spied through a module mock: its only caller
// on this path, `analysisData`, is DEFINED IN THE SAME FILE (lib/rowstate.ts)
// and calls the local top-level binding directly, which bypasses a `vi.mock`
// replacement of the file's exports (a same-module call is not indirected
// through the exports object the mock replaces — a well-known ESM/bundler
// limitation, confirmed empirically against this repo's Vite transform).
// `analysisData` IS the direct, faithful proxy for "was `droppedRows`
// exercised": `lib/panelwindow.buildOverlayPayload` imports and calls it
// ACROSS a module boundary once per dataset specifically to fold
// exclusion+filter (#50/#53) into the analysis view, and its own doc comment
// (lib/rowstate.ts) says as much. Spying there is therefore what actually
// answers the question load-invariant testing needs to ask.
const droppedRowsSpy = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rowstate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/rowstate")>();
  return {
    ...actual,
    analysisData: (...args: Parameters<typeof actual.analysisData>) => {
      droppedRowsSpy(...args);
      return actual.analysisData(...args);
    },
  };
});

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function dataset(id: string, name: string, time: number[]): Dataset {
  const data: DataStruct = {
    time,
    values: time.map((t) => [t * 10]),
    labels: ["a"],
    units: ["emu"],
    metadata: {},
  };
  return { id, name, data };
}

beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
  droppedRowsSpy.mockClear();
});

describe("PanelOverlayWindow — cheap re-render gate (no per-render row scan)", () => {
  it("does not call droppedRows again on a re-render with unchanged datasets (new outer array, same objects)", async () => {
    const a = dataset("a", "Alpha", [0, 1, 2]);
    const b = dataset("b", "Beta", [0, 1, 2]);

    const { rerender } = render(<PanelOverlayWindow datasets={[a, b]} />);
    await waitFor(() => expect(created.length).toBe(1));
    expect(droppedRowsSpy.mock.calls.length).toBeGreaterThan(0);
    const callsAfterFirstRender = droppedRowsSpy.mock.calls.length;

    // Simulate PanelPlotWindow's `.map().filter()` producing a BRAND NEW
    // array of the SAME dataset objects on an unrelated parent re-render.
    rerender(<PanelOverlayWindow datasets={[a, b]} />);
    expect(droppedRowsSpy.mock.calls.length).toBe(callsAfterFirstRender);

    // A second unrelated re-render (still the same objects) — still no calls.
    rerender(<PanelOverlayWindow datasets={[...[a, b]]} />);
    expect(droppedRowsSpy.mock.calls.length).toBe(callsAfterFirstRender);
  });

  it("calls droppedRows again once a dataset's exclusion state actually changes", async () => {
    const a = dataset("a", "Alpha", [0, 1, 2]);
    const b = dataset("b", "Beta", [0, 1, 2]);

    const { rerender } = render(<PanelOverlayWindow datasets={[a, b]} />);
    await waitFor(() => expect(created.length).toBe(1));
    const callsAfterFirstRender = droppedRowsSpy.mock.calls.length;

    // Real row-state mutation: a NEW dataset object with a NEW excludedRows
    // reference (the store's immutable-update convention), rows unchanged.
    const aExcluded: Dataset = { ...a, excludedRows: [1] };
    rerender(<PanelOverlayWindow datasets={[aExcluded, b]} />);
    await waitFor(() => expect(droppedRowsSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstRender));
  });
});

// Regression: exercised via the real store elsewhere (PanelPlotWindow.test.tsx
// covers the render + merged-series-label behavior); this file only targets
// the re-render memoization gate — see the top-of-file comment.
describe("PanelOverlayWindow — sanity: still renders one merged viewport", () => {
  it("renders a single viewport for the given datasets", async () => {
    useApp.setState({ datasets: [] });
    const a = dataset("a", "Alpha", [0, 1, 2]);
    const b = dataset("b", "Beta", [0, 1, 2]);
    const { container } = render(<PanelOverlayWindow datasets={[a, b]} />);
    await waitFor(() => expect(created.length).toBe(1));
    expect(container.querySelector(".qzk-panel-overlay")).not.toBeNull();
  });
});
