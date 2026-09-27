// P2.6 box 2: the Stat Stage's "empty levels" and "n" options are PlotView
// fields, so they persist with the plot — undo, window focus swaps, and a real
// .dwk save/reopen (serializeWorkspace -> parseWorkspace -> loadWorkspace, the
// actual persistence boundary), plus a hand-edited file that carries junk.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, sanitizePlotView } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { parseWorkspace } from "../lib/workspace";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { setStatHideEmptyLevels, setStatMarks, setStatShowGroupN } from "./statLevelOptions";
import { useApp } from "./useApp";

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [
    [0, 1],
    [1, 2],
    [0, 3],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C"] },
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "a", data: raw }],
    activeId: "d1",
    statHideEmptyLevels: false,
    statShowGroupN: true,
    statMarks: {},
    history: [],
    future: [],
  });
});

describe("Stat Stage level options (PlotView)", () => {
  it("default: empty levels shown, n captions on", () => {
    expect(defaultPlotView()).toMatchObject({ statHideEmptyLevels: false, statShowGroupN: true });
  });

  it("each setter is one undoable edit", () => {
    setStatHideEmptyLevels(true);
    setStatShowGroupN(false);
    expect(useApp.getState().history).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().statShowGroupN).toBe(true);
    expect(useApp.getState().statHideEmptyLevels).toBe(true);
  });

  it("survives a real .dwk save and reopen", () => {
    useApp.getState().setStatMode(true);
    setStatHideEmptyLevels(true);
    setStatShowGroupN(false);
    // The save path (store/workspaceIO.prepareWorkspaceState) folds the
    // focused window's live view in via windowsForSave(); mirror it.
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    // Reset the live state so the reopen has to bring the values back.
    useApp.setState({ statHideEmptyLevels: false, statShowGroupN: true });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statHideEmptyLevels).toBe(true);
    expect(useApp.getState().statShowGroupN).toBe(false);
  });

  it("a hand-edited file with junk values falls back to the defaults, field by field", () => {
    const v = sanitizePlotView({ statHideEmptyLevels: "yes", statShowGroupN: 0 });
    expect(v.statHideEmptyLevels).toBe(false);
    expect(v.statShowGroupN).toBe(true);
    // A file written before these fields existed opens with the defaults.
    const old = sanitizePlotView({ statMode: true });
    expect(old).toMatchObject({ statMode: true, statHideEmptyLevels: false, statShowGroupN: true });
  });
});

describe("Stat Stage categorical marks (PlotView.statMarks, P2.6 box 1)", () => {
  it("default: nothing set, every mode draws its defaults", () => {
    expect(defaultPlotView().statMarks).toEqual({});
  });

  it("each edit merges one patch and is one undo entry", () => {
    setStatMarks({ points: "all", jitterWidth: 0.5 });
    setStatMarks({ summary: "mean", errorBars: "sd" });
    expect(useApp.getState().statMarks).toEqual({ points: "all", jitterWidth: 0.5, summary: "mean", errorBars: "sd" });
    expect(useApp.getState().history).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().statMarks).toEqual({ points: "all", jitterWidth: 0.5 });
    useApp.getState().redo();
    expect(useApp.getState().statMarks.errorBars).toBe("sd");
  });

  it("survives a real .dwk save and reopen", () => {
    useApp.getState().setStatMode(true);
    const marks = {
      points: "none", jitter: false, jitterWidth: 0.25, summary: "median", errorBars: "ci95",
      connectMeans: true, labelRotation: 90, labelWrap: true,
    } as const;
    setStatMarks(marks);
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    useApp.setState({ statMarks: {} });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statMarks).toEqual(marks);
  });
});
