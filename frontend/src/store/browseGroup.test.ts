// Item 22: Browse graph with N curves per step, through the real store. The graph
// shows exactly the group's curves, and the export (the figure spec) names the same
// ones; one undo step per press; N = 1 is today's behaviour.

import { beforeEach, describe, expect, it } from "vitest";

import { visibleCurves } from "../lib/browseGraph";
import { buildFigureSpec } from "../lib/figureSpec";
import type { Dataset } from "../lib/types";
import { browseGraph } from "./browseGraphApply";
import { useBrowseSettings } from "./browseSettings";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const sheet = (id: string, labels: string[], base: number): Dataset => ({
  id, name: `S${id}`,
  data: { time: [0, 1], values: [labels.map((_, c) => base + c), labels.map((_, c) => base + 10 + c)], labels, units: labels.map(() => ""), metadata: {} },
});
const a = sheet("a", ["A", "B", "C", "D", "E"], 100);
const b = sheet("b", ["A", "B", "C", "D", "E"], 200);

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const cols = () => graph().linkedCurves!.map((c) => c.yKey);
const onScreen = () => visibleCurves(useApp.getState()).map((c) => graph().data.labels[c]);

beforeEach(() => {
  useApp.setState({
    datasets: [a, b], activeId: "a", selectedIds: [], history: [], future: [], workbooks: [],
    xKey: null, yKeys: [0], hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, y2Keys: null,
  });
  useBrowseSettings.setState({ perStep: 1, group: null });
  useToasts.setState({ toasts: [] });
});

describe("curves per step", () => {
  it("steps N columns together, tiling the sheet and wrapping, one undo step per press", () => {
    useBrowseSettings.getState().setPerStep(2);
    expect(browseGraph("column", 1)).toBe(true); // A -> the window starting at column 0+2 = C, D
    expect(cols()).toEqual([2, 3]);
    useApp.setState({ history: [] });
    expect(browseGraph("column", 1)).toBe(true); // E is last, alone: the last window is short, never padded
    expect(cols()).toEqual([4]);
    expect(browseGraph("column", 1)).toBe(true); // wraps
    expect(cols()).toEqual([0, 1]);
    expect(useApp.getState().history).toHaveLength(2); // one per press, the first was cleared above
    expect(browseGraph("column", -1)).toBe(true); // from the first window back to the last tile
    expect(cols()).toEqual([4]);
    expect(browseGraph("column", -1)).toBe(true);
    expect(cols()).toEqual([2, 3]);
    useApp.getState().undo();
    expect(cols()).toEqual([4]);
  });

  it("the screen, its legend labels and the export show exactly the same curves", () => {
    useBrowseSettings.getState().setPerStep(2);
    const opts = { fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };
    const exported = () => buildFigureSpec(() => useApp.getState(), graph(), "g", opts).y_keys;
    browseGraph("column", 1); // A -> C, D
    expect(onScreen()).toEqual(["C", "D"]);
    expect(exported()).toEqual(visibleCurves(useApp.getState()));
    browseGraph("column", 1); // E, alone: no stale curve is left from the pair
    expect(onScreen()).toEqual(["E"]);
    expect(exported()).toEqual(visibleCurves(useApp.getState()));
    browseGraph("column", 1); // wraps to A, B
    expect(onScreen()).toEqual(["A", "B"]);
    expect(exported()).toEqual([0, 1]);
    expect(graph().data.labels).toHaveLength(2);
  });

  it("shrinking N drops the extra curves; N = 1 again behaves as before", () => {
    useBrowseSettings.getState().setPerStep(2);
    browseGraph("column", 1);
    expect(cols()).toHaveLength(2);
    useBrowseSettings.getState().setPerStep(1);
    expect(browseGraph("column", 1)).toBe(true);
    expect(cols()).toHaveLength(1);
    expect(onScreen()).toHaveLength(1);
    expect(browseGraph("column", 1)).toBe(true);
    expect(cols()).toHaveLength(1);
  });

  it("drops the curves outside the group at N > 1, so the graph holds exactly the window", () => {
    useApp.setState({ yKeys: [0, 1], seriesStyles: { 1: { color: "#123456" } } });
    useBrowseSettings.getState().setPerStep(2);
    browseGraph("column", 1, 1); // group starts at B (visible place 1): B -> D, E; A is not in the group
    expect(cols()).toEqual([3, 4]);
    expect(onScreen()).toEqual(["D", "E"]);
  });

  // Acceptance 7 W3: all 7 columns plotted, 3 per step. The screen, legend and export hold exactly the window.
  it("a 7-curve plot at 3 per step shows exactly 1-3, 4-6, 7 and back, with no (2) duplicates", () => {
    const wide = sheet("w", ["s1", "s2", "s3", "s4", "s5", "s6", "s7"], 0);
    useApp.setState({ datasets: [wide], activeId: "w", yKeys: [0, 1, 2, 3, 4, 5, 6] });
    useBrowseSettings.getState().setPerStep(3);
    const opts = { fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };
    const check = (want: string[]) => {
      expect(onScreen()).toEqual(want);
      expect(graph().linkedCurves!.map((c) => wide.data.labels[c.yKey])).toEqual(want);
      expect(graph().data.labels).toEqual(want); // the legend names: no "s4 (2)"
      expect(buildFigureSpec(() => useApp.getState(), graph(), "g", opts).y_keys).toEqual(visibleCurves(useApp.getState()));
    };
    expect(browseGraph("column", 1)).toBe(true);
    check(["s4", "s5", "s6"]);
    expect(browseGraph("column", 1)).toBe(true);
    check(["s7"]);
    expect(browseGraph("column", 1)).toBe(true);
    check(["s1", "s2", "s3"]);
    expect(browseGraph("column", -1)).toBe(true);
    check(["s7"]);
    expect(browseGraph("column", -1)).toBe(true);
    check(["s4", "s5", "s6"]);
  });

  it("steps a group to the next sheet that carries all its columns", () => {
    useBrowseSettings.getState().setPerStep(2);
    browseGraph("column", 1); // C, D on sheet a
    expect(browseGraph("sheet", 1)).toBe(true);
    expect(graph().linkedCurves!.map((c) => [c.datasetId, c.yKey])).toEqual([["b", 2], ["b", 3]]);
    expect(onScreen()).toEqual(["C", "D"]);
  });

  it("refuses a sheet missing one of the group's columns, changing nothing", () => {
    useApp.setState({ datasets: [a, sheet("c", ["A", "B", "C"], 300)] });
    useBrowseSettings.getState().setPerStep(2);
    browseGraph("column", 1); // C, D: sheet c lacks D
    const before = JSON.stringify(graph().linkedCurves);
    expect(browseGraph("sheet", 1)).toBe(false);
    expect(JSON.stringify(graph().linkedCurves)).toBe(before);
  });
});

describe("a typed legend stays on its place in a group step (item 22)", () => {
  // Legend text as the legend dialog stores it: by the graph's curve slot (a live graph) or channel (a plain one).
  const typed = () => useApp.getState().seriesLabels;

  it("a renamed curve keeps its text through column steps; a slot the window no longer has loses it", () => {
    useBrowseSettings.getState().setPerStep(2);
    useApp.setState({ yKeys: [0], seriesLabels: { 0: "Run 1" } }); // a plain graph, its curve (A) renamed
    expect(browseGraph("column", 1)).toBe(true); // A -> C, D
    expect(cols()).toEqual([2, 3]);
    expect(typed()).toEqual({ 0: "Run 1" }); // slot 0 (now C) takes the text typed for slot 0
    useApp.setState({ seriesLabels: { 0: "Run 1", 1: "Reference" } }); // and D is renamed too
    expect(browseGraph("column", 1)).toBe(true); // E alone: the window is narrower, slot 1 is gone
    expect(cols()).toEqual([4]);
    expect(typed()).toEqual({ 0: "Run 1" });
    expect(browseGraph("column", 1)).toBe(true); // wraps to A, B
    expect(cols()).toEqual([0, 1]);
    expect(typed()).toEqual({ 0: "Run 1" });
  });

  it("a renamed slot keeps its text across sheets and is undone with the step", () => {
    useBrowseSettings.getState().setPerStep(2);
    useApp.setState({ yKeys: [0, 1], seriesLabels: { 0: "Run 1" } });
    browseGraph("column", -1); // wraps back from A, B to the last window
    expect(cols()).toEqual([4]);
    expect(typed()).toEqual({ 0: "Run 1" });
    expect(browseGraph("sheet", 1)).toBe(true); // to sheet b, same columns
    expect(graph().linkedCurves![0].datasetId).toBe("b");
    expect(typed()).toEqual({ 0: "Run 1" });
    useApp.getState().undo();
    expect(graph().linkedCurves![0].datasetId).toBe("a");
  });

  it("with no typed legend nothing is written", () => {
    useBrowseSettings.getState().setPerStep(2);
    browseGraph("column", 1);
    expect(typed()).toEqual({});
  });
});
