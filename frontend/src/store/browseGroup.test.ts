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

  it("keeps the other curves of the graph and the first curve's style", () => {
    useApp.setState({ yKeys: [0, 1], seriesStyles: { 1: { color: "#123456" } } });
    useBrowseSettings.getState().setPerStep(2);
    // The browsed curve is the first visible one (A); B stays beside it... and is replaced when inside the group.
    browseGraph("column", 1, 1); // group starts at B (visible place 1): B -> D, E
    expect(cols()).toEqual([0, 3, 4]);
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "a", yKey: 0 });
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
