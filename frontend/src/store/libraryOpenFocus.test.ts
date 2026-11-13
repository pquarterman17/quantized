// Figures leftover f: double-clicking a Library dataset that ANOTHER window
// already shows rebound the focused window to it (so two windows showed the
// same data and the focused one lost its own). Origin brings the open
// window forward instead; so does this.
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotWindow } from "../lib/plotview";
import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

function data(): DataStruct {
  return { time: [1, 2, 3], values: [[1, 10], [2, 20], [3, 30]], labels: ["M", "R"], units: ["", ""], metadata: {} };
}
const ds = (id: string): Dataset => ({ id, name: `${id}.csv`, data: data() });
const act = () => useApp.getState();
const focused = (): PlotWindow => act().plotWindows.find((w) => w.id === act().focusedWindowId)!;
const byId = (id: string): PlotWindow => act().plotWindows.find((w) => w.id === id)!;

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
});

/** mt in a styled main window, decay in a second (unstyled, focused) one. */
function twoWindows(): { main: string; second: string } {
  act().addDataset(ds("mt"));
  const main = focused().id;
  act().setPlotTitle("Sample A");
  act().addDataset(ds("decay"));
  return { main, second: focused().id };
}

describe("opening a Library dataset another window shows (leftover f)", () => {
  it("focuses that window and rebinds nothing", () => {
    const { main, second } = twoWindows();
    expect(second).not.toBe(main);
    act().activateFromLibrary("mt");
    expect(focused().id).toBe(main);
    expect(act().activeId).toBe("mt");
    expect(act().plotTitle).toBe("Sample A");
    expect(byId(second).datasetId).toBe("decay");
    expect(act().plotWindows).toHaveLength(2);
    act().activateFromLibrary("decay");
    expect(focused().id).toBe(second);
    expect(byId(main).datasetId).toBe("mt");
  });

  it("restores a minimized window that shows it", () => {
    const { main } = twoWindows();
    act().minimizeWindow(main);
    act().activateFromLibrary("mt");
    expect(focused().id).toBe(main);
    expect(byId(main).winState).not.toBe("minimized");
  });

  it("a dataset no window shows still opens the normal way", () => {
    const { main, second } = twoWindows();
    act().addDataset(ds("third")); // the unedited second window takes it
    expect(byId(second).datasetId).toBe("third");
    act().activateFromLibrary("decay"); // shown nowhere now: the focused, unedited window rebinds
    expect(focused().id).toBe(second);
    expect(byId(second).datasetId).toBe("decay");
    expect(byId(main).datasetId).toBe("mt");
    expect(act().plotWindows).toHaveLength(2);
  });
});
