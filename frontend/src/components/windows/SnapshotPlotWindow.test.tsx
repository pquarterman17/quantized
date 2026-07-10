// Snapshot windows (MULTI_PLOT_PLAN item 11): a kind:"snapshot" window
// renders its FROZEN bundle verbatim — no fetch, no rowstate, no dataset
// binding. The core proof here is the item's own test requirement: toggling
// row exclusion on the source dataset does NOT change a snapshot window's
// payload (frozen means frozen), while a live window on the same dataset
// does change. Rendered through WindowCanvas so the kind dispatch (snapshot
// vs focused-PlotStage vs background) is exercised too.
//
// Same headless-uPlot recorder mock as WindowCanvas.test.tsx.

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FrozenPlotBundle } from "../../lib/plotsnapshot";
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

// A frozen bundle with a DISTINCTIVE y column (99…96) so its uPlot instance
// is unambiguously identifiable among the recorder's captures — and so this
// test also proves the snapshot renders the bundle, not the live dataset.
const FROZEN: FrozenPlotBundle = {
  payload: {
    data: [
      [0, 1, 2, 3],
      [99, 98, 97, 96],
    ] as FrozenPlotBundle["payload"]["data"],
    series: [{ label: "a", unit: "" }],
    xLabel: "x",
    xUnit: "",
  },
  styleList: null,
  labelList: null,
  errorBars: [],
  hidden: null,
};

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

const snapWin = (over: Partial<PlotWindow> = {}): PlotWindow =>
  win({ id: "s1", kind: "snapshot", datasetId: null, title: "Snapshot — ds1", snapshot: FROZEN, ...over });

const isFrozenData = (c: { data: unknown }): boolean =>
  (c.data as (number | null)[][])[1]?.[0] === 99;

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

describe("SnapshotPlotWindow (item 11) — static frozen rendering", () => {
  it("renders the frozen bundle verbatim (not the live dataset) alongside the focused live window", async () => {
    useApp.setState({ plotWindows: [win(), snapWin()], focusedWindowId: "w1" });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2)); // one live + one snapshot
    const frozenInstances = created.filter(isFrozenData);
    expect(frozenInstances).toHaveLength(1);
    expect((frozenInstances[0].data as (number | null)[][])[1]).toEqual([99, 98, 97, 96]);
    // The frame chrome shows the frozen indicator + the snapshot title.
    expect(container.textContent).toContain("⎘ frozen");
    expect(container.textContent).toContain("Snapshot — ds1");
  });

  it("FROZEN MEANS FROZEN: toggling row exclusion changes the live window but never the snapshot", async () => {
    useApp.setState({ plotWindows: [win(), snapWin()], focusedWindowId: "w1" });
    render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));

    useApp.getState().toggleRowExcluded("d1", 0);

    // The LIVE window rebuilds (twice — the dataset-reference change re-fires
    // the fetch effect, same pre-existing behavior WindowCanvas.test.tsx's
    // row-state proof documents); the snapshot window must NOT rebuild at all
    // (its frozen bundle's identity never changed).
    await waitFor(() => expect(created.length).toBe(4));
    const afterToggle = created.slice(2);
    for (const c of afterToggle) {
      expect(isFrozenData(c)).toBe(false); // every rebuild is the live window…
      expect((c.data as (number | null)[][])[1][0]).toBeNull(); // …and it honors the exclusion
    }
    // The frozen bundle itself is untouched — in the store record and in the
    // one snapshot uPlot instance ever created.
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "s1")?.snapshot?.payload.data[1][0]).toBe(99);
    expect(created.filter(isFrozenData)).toHaveLength(1);
  });

  it("keeps rendering after the source dataset is removed entirely (no dataset binding at all)", async () => {
    useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
    useApp.setState({ plotWindows: [win({ datasetId: null }), snapWin()], focusedWindowId: "w1" });
    const { container } = render(<WindowCanvas />);
    // Only the snapshot plots (the unbound focused window has nothing to draw).
    await waitFor(() => expect(created.filter(isFrozenData).length).toBe(1));
    expect(container.textContent).toContain("⎘ frozen");
    expect(container.textContent).not.toContain("No dataset — drag one onto this window");
  });

  it("a pointerdown on the snapshot frame raises it without stealing focus from the live window", async () => {
    useApp.setState({
      plotWindows: [win({ z: 5 }), snapWin({ z: 1 })],
      focusedWindowId: "w1",
    });
    const { container } = render(<WindowCanvas />);
    await waitFor(() => expect(created.length).toBe(2));
    const frames = container.querySelectorAll(".qzk-plotwin");
    const snapFrame = [...frames].find((f) => f.textContent?.includes("frozen"))!;
    fireEvent.pointerDown(snapFrame, { clientX: 10, clientY: 10, button: 0 });
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w1"); // never a snapshot
    expect(s.plotWindows.find((w) => w.id === "s1")!.z).toBeGreaterThan(
      s.plotWindows.find((w) => w.id === "w1")!.z,
    );
  });
});
