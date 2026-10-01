// P2.6 box 2: the Stat Stage's "empty levels" and "n" options are PlotView
// fields, so they persist with the plot — undo, window focus swaps, and a real
// .dwk save/reopen (serializeWorkspace -> parseWorkspace -> loadWorkspace, the
// actual persistence boundary), plus a hand-edited file that carries junk.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, sanitizePlotView } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { parseWorkspace } from "../lib/workspace";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { setStatHideEmptyLevels, setStatMarks, setStatShowGroupN, setStatShowSummary } from "./statLevelOptions";
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
    statShowSummary: false,
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

// P2.6 box 4 leftover: the summary table's visibility was session-local
// (`useState` in StatStage); it is now the third persisted option.
describe("Stat Stage summary-table visibility (PlotView.statShowSummary)", () => {
  it("default: the table is closed", () => {
    expect(defaultPlotView().statShowSummary).toBe(false);
    expect(useApp.getState().statShowSummary).toBe(false);
  });

  it("the setter is one undoable edit", () => {
    setStatShowSummary(true);
    expect(useApp.getState().statShowSummary).toBe(true);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().statShowSummary).toBe(false);
    useApp.getState().redo();
    expect(useApp.getState().statShowSummary).toBe(true);
  });

  it("survives a real .dwk save and reopen", () => {
    useApp.getState().setStatMode(true);
    setStatShowSummary(true);
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    useApp.setState({ statShowSummary: false });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statShowSummary).toBe(true);
  });

  it("a junk or pre-field file opens with the table closed", () => {
    expect(sanitizePlotView({ statShowSummary: "yes" }).statShowSummary).toBe(false);
    expect(sanitizePlotView({ statShowSummary: 1 }).statShowSummary).toBe(false);
    expect(sanitizePlotView({ statMode: true })).toMatchObject({ statMode: true, statShowSummary: false });
    expect(sanitizePlotView({ statShowSummary: true }).statShowSummary).toBe(true);
  });
});

describe("Stat Stage categorical marks (PlotView.statMarks, P2.6 box 1)", () => {
  it("default: nothing set, every mode draws its defaults", () => {
    expect(defaultPlotView().statMarks).toEqual({});
  });

  it("each edit merges one patch, under its mode's OWN bucket, and is one undo entry", () => {
    setStatMarks("box", { points: "all", jitterWidth: 0.5 });
    setStatMarks("box", { summary: "mean", errorBars: "sd" });
    expect(useApp.getState().statMarks).toEqual({
      box: { points: "all", jitterWidth: 0.5, summary: "mean", errorBars: "sd" },
    });
    expect(useApp.getState().history).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().statMarks).toEqual({ box: { points: "all", jitterWidth: 0.5 } });
    useApp.getState().redo();
    expect(useApp.getState().statMarks.box?.errorBars).toBe("sd");
  });

  it("survives a real .dwk save and reopen", () => {
    useApp.getState().setStatMode(true);
    const marks = {
      points: "none", jitter: false, jitterWidth: 0.25, summary: "median", errorBars: "ci95",
      connectMeans: true, labelRotation: 90, labelWrap: true,
    } as const;
    setStatMarks("strip", marks);
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    useApp.setState({ statMarks: {} });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    expect(useApp.getState().statMarks).toEqual({ strip: marks });
  });

  // Review finding 6.
  describe("mode isolation — a choice in one mode never becomes another mode's default", () => {
    it("strip's points: none never darkens box's own fliers", () => {
      setStatMarks("box", { points: "outliers" });
      setStatMarks("strip", { points: "none" });
      expect(useApp.getState().statMarks.box).toEqual({ points: "outliers" });
      expect(useApp.getState().statMarks.strip).toEqual({ points: "none" });
    });

    it("box's CI error bars never leak into bar's SE default", () => {
      setStatMarks("box", { errorBars: "ci95" });
      expect(useApp.getState().statMarks.bar).toBeUndefined(); // bar keeps its OWN default (se)
      setStatMarks("bar", { errorBars: "sd" });
      expect(useApp.getState().statMarks.box?.errorBars).toBe("ci95"); // unaffected by bar's own edit
      expect(useApp.getState().statMarks.bar?.errorBars).toBe("sd");
    });

    it("each mode's edit is its own undo entry, and undo restores only that mode's bucket", () => {
      setStatMarks("box", { points: "all" });
      setStatMarks("violin", { points: "outliers" });
      useApp.getState().undo();
      expect(useApp.getState().statMarks.violin).toBeUndefined();
      expect(useApp.getState().statMarks.box).toEqual({ points: "all" }); // box's edit stands
    });
  });

  // Review finding 6: `.dwk` migration from the pre-review flat shape.
  describe("migration from the flat (pre-review) statMarks shape", () => {
    it("a legacy flat object is applied to EVERY mode's bucket (documented in sanitizeStatMarksByMode)", () => {
      const legacy = { points: "all", summary: "mean", errorBars: "sd" };
      const v = sanitizePlotView({ statMarks: legacy });
      expect(v.statMarks.box).toEqual(legacy);
      expect(v.statMarks.violin).toEqual(legacy);
      expect(v.statMarks.strip).toEqual(legacy);
      expect(v.statMarks.bar).toEqual(legacy);
      // Four independent copies, not the same reference re-merged four
      // times — writing into one bucket later must not touch the others.
      useApp.setState({ statMarks: v.statMarks });
      setStatMarks("box", { points: "none" });
      expect(useApp.getState().statMarks.bar?.points).toBe("all");
    });

    it("the NEW per-mode shape passes through untouched (no double-migration)", () => {
      const v = sanitizePlotView({
        statMarks: { box: { points: "outliers" }, bar: { errorBars: "sd" } },
      });
      expect(v.statMarks).toEqual({ box: { points: "outliers" }, bar: { errorBars: "sd" } });
    });

    it("an empty / absent statMarks stays empty (not migrated into four empty buckets)", () => {
      expect(sanitizePlotView({}).statMarks).toEqual({});
      expect(sanitizePlotView({ statMarks: {} }).statMarks).toEqual({});
    });

    it("junk drops field by field, exactly as the flat sanitizer always did, per mode", () => {
      const v = sanitizePlotView({
        statMarks: { box: { points: "sideways", summary: "mean" }, bar: "not an object" },
      });
      expect(v.statMarks.box).toEqual({ summary: "mean" });
      expect(v.statMarks.bar).toEqual({});
    });
  });
});
