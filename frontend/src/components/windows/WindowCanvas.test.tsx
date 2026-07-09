// WindowCanvas is the item-3 migration-guarantee boundary: a single
// maximized window renders `PlotStage` alone (no chrome, no extra host div —
// pixel-identical to the pre-MULTI_PLOT_PLAN Stage); ≥2 windows get MDI
// chrome (one `PlotWindowFrame` per window, exactly one carrying the
// "focused" highlight). Every frame hosts the full `PlotStage` composition
// for now — item 4 splits this into focused-vs-background rendering.
//
// Real uPlot needs a browser canvas/layout engine neither jsdom nor this
// test cares about; the constructor is mocked to a lightweight recorder (the
// MultiPanelStage.test.tsx pattern) so PlotStage's render effect can run
// headlessly.

import { render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import WindowCanvas from "./WindowCanvas";

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

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["a"],
  units: [""],
  metadata: {},
};

const DATASET: Dataset = { id: "d1", name: "ds1", data: DATA };

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  ...over,
});

// Stubbed for the WHOLE file (not per-test): a fetchPlot promise that
// resolves after a test's own `afterEach` has already unstubbed globals would
// otherwise throw "ResizeObserver is not defined" from a stray PlotViewport
// mount effect, misattributed to whatever test happened to run next.
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
  useApp.setState({ datasets: [DATASET], activeId: "d1", selectedIds: ["d1"] });
});
afterEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    plotWindows: [win({ winState: "maximized" })],
    focusedWindowId: "w1",
  });
});

describe("WindowCanvas — single maximized window (migration guarantee)", () => {
  it("renders PlotStage alone — no wincanvas host, no plotwin chrome", async () => {
    useApp.setState({ plotWindows: [win({ id: "w1", winState: "maximized" })], focusedWindowId: "w1" });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    expect(container.querySelector(".qzk-wincanvas")).toBeNull();
    expect(container.querySelector(".qzk-plotwin")).toBeNull();
    expect(container.querySelector(".qzk-stage")).not.toBeNull();
    expect(created).toHaveLength(1); // exactly one live plot instance
  });
});

describe("WindowCanvas — ≥2 windows (MDI chrome)", () => {
  it("renders one PlotWindowFrame per window; exactly one carries the focus highlight", async () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "normal" })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2)); // one uPlot per window
    expect(container.querySelectorAll(".qzk-plotwin")).toHaveLength(2);
    expect(container.querySelectorAll(".qzk-plotwin.focused")).toHaveLength(1);
    // Dataset badge threaded through from the window's OWN datasetId.
    expect(container.querySelectorAll(".qzk-plotwin-badge")).toHaveLength(2);
  });
});
