// Soak test issue 1 (HIGH): Ctrl+Z after switching windows used to move the
// focused window's zoom onto the window the undo restored, and throw away the
// focused window's own zoom. `restorePatch` (store/historySnapshot.ts) kept
// the LIVE navigation fields — which belong to whichever window is focused
// NOW — and applied them to the snapshot's focused window, while restoring
// `plotWindows` wholesale dropped the live window's never-written-back zoom.
// Navigation stays outside the edit undo domain, but per window.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { plotWindowView } from "./windowDocuments";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({ fetchBookData: vi.fn() }));

const raw: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };

const win = (id: string, datasetId: string, z: number): PlotWindow => ({
  id,
  kind: "plot",
  title: "",
  datasetId,
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
});

const app = () => useApp.getState();
const record = (id: string) => plotWindowView(app().plotWindows.find((w) => w.id === id)!);

beforeEach(() => {
  useApp.setState({
    datasets: [
      { id: "xrd", name: "xrd", data: raw },
      { id: "mh", name: "mh", data: raw },
    ],
    activeId: "mh",
    selectedIds: ["mh"],
    history: [],
    future: [],
    viewHistory: [],
    viewFuture: [],
    ...defaultPlotView(),
    plotWindows: [win("A", "xrd", 1), win("B", "mh", 2)],
    focusedWindowId: "B",
  });
});

describe("undo/redo after a window switch keeps each window's own zoom", () => {
  it("restores B's title without stealing or overwriting A's live zoom", () => {
    app().setXLim([-20000, 20000]);
    app().setYLim([-1, 1]);
    app().setPlotTitle("B title"); // the undoable edit, on B
    app().focusWindow("A");
    app().setXLim([30, 60]); // A's zoom: live only, never written to A's record yet

    app().undo();
    // Focus follows the snapshot to B, which shows ITS OWN zoom, not A's.
    expect(app().focusedWindowId).toBe("B");
    expect(app().plotTitle).toBe("");
    expect(app().xLim).toEqual([-20000, 20000]);
    expect(app().yLim).toEqual([-1, 1]);
    // A's live zoom was written back into its record, not dropped.
    expect(record("A").xLim).toEqual([30, 60]);

    app().focusWindow("A");
    expect(app().xLim).toEqual([30, 60]);

    // Redo returns to the state the undo left (focus on A), with B's title
    // back in B's record — and again neither window's zoom crosses over.
    app().redo();
    expect(app().focusedWindowId).toBe("A");
    expect(app().xLim).toEqual([30, 60]);
    expect(record("B").plotTitle).toBe("B title");
    expect(record("B").xLim).toEqual([-20000, 20000]);
    expect(record("B").yLim).toEqual([-1, 1]);
  });

  it("an undo on the same window still keeps a later zoom (unchanged rule)", () => {
    app().setPlotTitle("t");
    app().setXLim([1, 2]);
    app().undo();
    expect(app().plotTitle).toBe("");
    expect(app().xLim).toEqual([1, 2]);
  });
});
