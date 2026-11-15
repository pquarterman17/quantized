// Soak test issue 4: a 2-D map window came back as a 1-D scatter plot after a
// visit to another window. `stageTab` is one global field and the focus
// handoff never set it, so the map window returned on whatever tab the other
// window had left (Plot, or Worksheet). Each window now gets its own tab back.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({ fetchBookData: vi.fn() }));

const line: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["I"], units: [""], metadata: {} };
const map: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[0, 0, 5], [0, 1, 6], [1, 0, 7], [1, 1, 8]],
  labels: ["omega", "2theta", "I"],
  units: ["", "", ""],
  metadata: { is2D: true },
};

let seq = 0;
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
let M = "", X = "";

beforeEach(() => {
  // Fresh ids per test: the per-window tab memory is keyed by window id.
  seq += 1;
  M = `map-${seq}`;
  X = `xrd-${seq}`;
  useApp.setState({
    datasets: [
      { id: "rsm", name: "rsm", data: map },
      { id: "xrd", name: "xrd", data: line },
    ],
    activeId: "rsm",
    selectedIds: ["rsm"],
    ...defaultPlotView(),
    plotWindows: [win(M, "rsm", 1), win(X, "xrd", 2)],
    focusedWindowId: M,
    stageTab: "map",
  });
});

describe("focus switches restore each window's stage tab", () => {
  it("a map window comes back on the Map tab after a visit to a 1-D window", () => {
    app().focusWindow(X);
    expect(app().stageTab).toBe("plot");
    app().focusWindow(M);
    expect(app().stageTab).toBe("map");
  });

  it("…even when the other window was left on the Worksheet tab", () => {
    app().focusWindow(X);
    app().setStageTab("worksheet");
    app().focusWindow(M);
    expect(app().stageTab).toBe("map");
    app().focusWindow(X);
    expect(app().stageTab).toBe("worksheet");
  });

  it("a map window focused for the first time opens on its Map tab", () => {
    useApp.setState({ focusedWindowId: X, activeId: "xrd", selectedIds: ["xrd"], stageTab: "plot" });
    app().focusWindow(M);
    expect(app().stageTab).toBe("map");
  });

  it("leaves the Technique view alone (it is not per window)", () => {
    app().setStageTab("technique");
    app().focusWindow(X);
    expect(app().stageTab).toBe("technique");
  });
});
