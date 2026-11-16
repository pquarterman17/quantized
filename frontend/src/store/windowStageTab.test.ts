// Soak test issue 4: a 2-D map window came back as a 1-D scatter plot after a
// visit to another window. `stageTab` is one global field and the focus
// handoff never set it, so the map window returned on whatever tab the other
// window had left (Plot, or Worksheet). Each window now gets its own tab back.
// Review follow-ups: the memory is per window AND binding (T1), forgotten on a
// workspace replace and a window close (T2), and a tab a caller set just
// before focusing is kept (T3).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";
import { resetWindowStageTabs } from "./windowFocus";

vi.mock("../lib/api", () => ({ fetchBookData: vi.fn() }));

const line: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["I"], units: [""], metadata: {} };
const map: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[0, 0, 5], [0, 1, 6], [1, 0, 7], [1, 1, 8]],
  labels: ["omega", "2theta", "I"],
  units: ["", "", ""],
  metadata: { is2D: true },
};

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
/** A user's tab click and their next window click are separate events. */
const nextEvent = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(async () => {
  resetWindowStageTabs();
  await nextEvent(); // no caller-set flag left from an earlier test
  useApp.setState({
    datasets: [
      { id: "rsm", name: "rsm", data: map },
      { id: "xrd", name: "xrd", data: line },
    ],
    activeId: "rsm",
    selectedIds: ["rsm"],
    ...defaultPlotView(),
    plotWindows: [win("M", "rsm", 1), win("X", "xrd", 2)],
    focusedWindowId: "M",
    stageTab: "map",
  });
});

describe("focus switches restore each window's stage tab", () => {
  it("a map window comes back on the Map tab after a visit to a 1-D window", () => {
    app().focusWindow("X");
    expect(app().stageTab).toBe("plot");
    app().focusWindow("M");
    expect(app().stageTab).toBe("map");
  });

  it("…even when the other window was left on the Worksheet tab", async () => {
    app().focusWindow("X");
    app().setStageTab("worksheet");
    await nextEvent();
    app().focusWindow("M");
    expect(app().stageTab).toBe("map");
    app().focusWindow("X");
    expect(app().stageTab).toBe("worksheet");
  });

  it("a map window focused for the first time opens on its Map tab", () => {
    useApp.setState({ focusedWindowId: "X", activeId: "xrd", selectedIds: ["xrd"], stageTab: "plot" });
    app().focusWindow("M");
    expect(app().stageTab).toBe("map");
  });

  it("leaves the Technique view alone (it is not per window)", async () => {
    app().setStageTab("technique");
    await nextEvent();
    app().focusWindow("X");
    expect(app().stageTab).toBe("technique");
  });
});

describe("review follow-ups", () => {
  it("a window given new data comes back on the NEW data's tab, not the old one's (T1)", () => {
    app().focusWindow("X"); // X remembered as Plot for xrd
    app().focusWindow("M");
    app().rebindWindow("X", "rsm"); // X gets the 2-D map in the background
    app().focusWindow("X");
    expect(app().stageTab).toBe("map");
  });

  it("a replaced workspace forgets every remembered tab (T2)", () => {
    useApp.setState({ stageTab: "worksheet" });
    app().focusWindow("X"); // M remembered as Worksheet (for rsm)
    app().clearAll(); // File ▸ Remove all = loadWorkspace(empty)
    useApp.setState({
      datasets: [{ id: "xrd", name: "xrd", data: line }, { id: "rsm", name: "rsm", data: map }],
      plotWindows: [win("M", "rsm", 1), win("X", "xrd", 2)], // the same ids, from a reopened file
      focusedWindowId: "X",
      activeId: "xrd",
      stageTab: "plot",
    });
    app().focusWindow("M");
    expect(app().stageTab).toBe("map"); // its dataset's default, not the old session's Worksheet
  });

  it("a closed window's memory goes with it (T2)", () => {
    app().focusWindow("X"); // M remembered as Map
    app().closeWindow("M");
    useApp.setState({ plotWindows: [...app().plotWindows, win("M", "rsm", 3)] }); // a new window reusing the id
    useApp.setState({ stageTab: "worksheet" });
    app().focusWindow("M");
    expect(app().stageTab).toBe("worksheet"); // nextStageTab keeps Worksheet; no stale Map
  });

  it("a tab the caller set just before focusing is kept (T3)", () => {
    app().focusWindow("X");
    app().focusWindow("M"); // M remembered as Map
    app().focusWindow("X");
    app().setStageTab("worksheet");
    app().focusWindow("M"); // same tick: the caller's Worksheet wins
    expect(app().stageTab).toBe("worksheet");
  });
});
