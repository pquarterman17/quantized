// P1.5 (PRIMARY_SOFTWARE_AUDIT_PLAN): the live "Group" well's channel is a
// durable, focused-window-facade field -- mirrors setXKey exactly (undo
// history entry + macro record), and survives the same window
// focus/duplicate/close-reopen round trips every other PlotView field does
// (via lib/plotview.ts's `snapshotView`/`hydrateView`, generic over
// whatever `defaultPlotView()` enumerates).

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 0],
    [20, 1],
    [30, 0],
  ],
  labels: ["Moment", "Sample"],
  units: ["emu", ""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    groupKey: null,
    history: [],
    future: [],
    macroRecording: false,
    macroSteps: [],
  });
});

describe("groupKey (P1.5 Group well)", () => {
  it("defaults to null", () => {
    expect(useApp.getState().groupKey).toBeNull();
  });

  it("setGroupKey sets the channel and records undo history + a macro step", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }], activeId: "d1" });
    useApp.getState().startMacro();
    useApp.getState().setGroupKey(1);
    expect(useApp.getState().groupKey).toBe(1);
    expect(useApp.getState().history).toHaveLength(1);
    const steps = useApp.getState().macroSteps;
    expect(steps.at(-1)?.code).toBe("qz.setGroupKey(1)");
  });

  it("setGroupKey(null) clears the split", () => {
    useApp.getState().setGroupKey(2);
    useApp.getState().setGroupKey(null);
    expect(useApp.getState().groupKey).toBeNull();
  });

  it("undo restores the previous groupKey", () => {
    useApp.getState().setGroupKey(1);
    useApp.getState().setGroupKey(2);
    useApp.getState().undo();
    expect(useApp.getState().groupKey).toBe(1);
  });

  it("survives a window focus swap (snapshotView/hydrateView round trip)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }], activeId: "d1" });
    const w1 = useApp.getState().focusedWindowId!;
    const w2 = useApp.getState().createWindow("d1");
    useApp.getState().focusWindow(w2);
    useApp.getState().setGroupKey(1);
    useApp.getState().focusWindow(w1);
    expect(useApp.getState().groupKey).toBeNull(); // w1 never had a group set
    useApp.getState().focusWindow(w2);
    expect(useApp.getState().groupKey).toBe(1); // w2's own groupKey survived the swap
  });

  it("P1.5 item 2: survives a workspace save/reopen (.dwk) round trip", () => {
    const win: PlotWindow = {
      id: "w1",
      kind: "plot",
      title: "grouped",
      datasetId: "d1",
      geometry: { x: 0, y: 0, w: 480, h: 360 },
      z: 0,
      winState: "maximized",
      view: { ...defaultPlotView(), groupKey: 3 },
      bg: "theme",
      linkGroup: null,
      pinned: false,
    };
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      plotWindows: [win],
      focusedWindowId: "w1",
    });
    expect(useApp.getState().groupKey).toBe(3);
    // Editable after reopen (item 2): a further edit commits normally.
    useApp.getState().setGroupKey(1);
    expect(useApp.getState().groupKey).toBe(1);
  });
});
