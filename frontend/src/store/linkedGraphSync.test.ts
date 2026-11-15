// Review findings 4, 5, 10 (end to end), 11 and the Origin-style naming for the
// live graph: watcher stamp covers channelTypes + source names, a column-
// changing re-import re-maps (never re-binds) the curves that read it, Plot
// together puts each Y on its own X, the legend follows a source rename, and
// new graphs are named Graph1, Graph2 ...

import { beforeEach, describe, expect, it, vi } from "vitest";

import { assembleLinkedCurves, linkedGraphMask } from "../lib/linkedCurves";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset, LinkedCurve } from "../lib/types";
import { flushLinkedCurves, noteAssembled, relinkedDatasets, watchLinkedCurves } from "./linkedCurvesSync";
import { applyReimportMerge, computeReimportMerge } from "./reimport";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("./paramDialog", () => ({ askParams: vi.fn() }));

const plain = (id: string, name: string, y: number[], labels = ["Y"]): Dataset => ({
  id,
  name,
  data: { time: y.map((_, i) => i + 1), values: y.map((v) => labels.map(() => v)), labels, units: labels.map(() => "V"), metadata: {} },
});
const get = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;
const graphs = () => useApp.getState().datasets.filter((d) => d.linkedCurves);

beforeEach(() => {
  useApp.setState({ datasets: [plain("a", "Sample A", [1, 2, 3]), plain("b", "Sample B", [4, 5, 6])], selectedIds: [], history: [], future: [], activeId: null });
  useToasts.setState({ toasts: [] });
});

describe("finding 5: the watcher notices a channelTypes change", () => {
  it("a type override that changes which filter rows apply rebuilds the graph", () => {
    const src: Dataset = { ...plain("s", "S", [1, 2, 3]), filter: [{ col: 0, kind: "range", min: 2, max: 10 } as never] };
    const curves: LinkedCurve[] = [{ datasetId: "s", xKey: null, yKey: 0, label: "S" }];
    const g = noteAssembled({ id: "g", name: "g", data: assembleLinkedCurves(curves, [src]), linkedCurves: curves }, [src]);
    expect(relinkedDatasets([src, g])).toBeNull();
    const src2 = { ...src, channelTypes: { 0: "nominal" as const } };
    const next = relinkedDatasets([src2, g]);
    expect(next).not.toBeNull();
    // The filter's dropped rows are the graph's mask (keyed to the source points).
    expect(next!.find((d) => d.id === "g")!.excludedRows).toEqual(linkedGraphMask(curves, [src2]));
    expect(linkedGraphMask(curves, [src2])).not.toEqual(linkedGraphMask(curves, [src]));
  });
});

describe("finding 4: a column-changing re-import re-maps curves by label, never re-binds", () => {
  it("follows a reordered column, empties a vanished one", async () => {
    const src = plain("s", "S", [1, 2, 3], ["A", "B", "C"]);
    const curves: LinkedCurve[] = [
      { datasetId: "s", xKey: null, yKey: 0, label: "A" },
      { datasetId: "s", xKey: null, yKey: 1, label: "B" },
      { datasetId: "s", xKey: 2, yKey: 0, label: "A on C" },
    ];
    const g: Dataset = { id: "g", name: "g", data: assembleLinkedCurves(curves, [src]), linkedCurves: curves };
    useApp.setState({ datasets: [src, g] });
    watchLinkedCurves();
    // The fresh file: B moved first, A kept, C gone, D new.
    const fresh = { ...src.data, labels: ["B", "A", "D"], units: ["V", "V", "V"], values: [[20, 10, 0], [20, 10, 0], [20, 10, 0]] };
    const merge = await computeReimportMerge(useApp.getState, get("s"), fresh);
    expect(merge.columnsChanged).toBe(true);
    applyReimportMerge(useApp.setState, useApp.getState, get("s"), merge);
    flushLinkedCurves();
    const lc = get("g").linkedCurves!;
    expect(lc.map((c) => c.yKey)).toEqual([1, 0, 1]); // A -> 1, B -> 0
    expect(lc[2].xKey).toBe(-1); // C vanished: its X is missing, the curve draws empty
    expect(get("g").data.values.map((r) => r[0]).filter(Number.isFinite)).toEqual([10, 10, 10]); // A's values, from A's column
  });

  it("a duplicated label is ambiguous and goes missing rather than picking one", async () => {
    const src = plain("s", "S", [1, 2, 3], ["A", "B"]);
    const curves: LinkedCurve[] = [{ datasetId: "s", xKey: null, yKey: 0, label: "A" }];
    useApp.setState({ datasets: [src, { id: "g", name: "g", data: assembleLinkedCurves(curves, [src]), linkedCurves: curves }] });
    watchLinkedCurves();
    const fresh = { ...src.data, labels: ["A", "A", "Z"], units: ["", "", ""], values: [[1, 2, 3], [1, 2, 3], [1, 2, 3]] };
    const merge = await computeReimportMerge(useApp.getState, get("s"), fresh);
    applyReimportMerge(useApp.setState, useApp.getState, get("s"), merge);
    flushLinkedCurves();
    expect(get("g").linkedCurves![0].yKey).toBe(-1);
  });
});

describe("Plot together: designations, labels, names", () => {
  it("puts R2 on T2 and keeps a designated X out of the Ys", async () => {
    const sheet: Dataset = {
      id: "s",
      name: "Sheet",
      data: { time: [1, 2, 3], values: [[10, 5, 100], [20, 3, 200], [30, 9, 300]], labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} },
      columnDesignations: { 1: "X" },
    };
    useApp.setState({ datasets: [sheet, plain("a", "Sample A", [1, 2, 3])] });
    await plotSelectedTogether(["s", "a"]);
    const g = graphs()[0];
    expect(g.linkedCurves!.map((c) => [c.datasetId, c.xKey, c.yKey])).toEqual([["s", null, 0], ["s", 1, 2], ["a", null, 0]]);
    const r2 = g.data.values.map((row, r) => [g.data.time[r], row[1]]).filter(([, v]) => Number.isFinite(v));
    expect(r2).toEqual([[5, 100], [3, 200], [9, 300]]);
  });

  it("the legend follows a source rename", async () => {
    await plotSelectedTogether(["a", "b"]);
    expect(graphs()[0].data.labels).toEqual(["Sample A", "Sample B"]);
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, name: "Renamed" } : d)) }));
    flushLinkedCurves();
    expect(graphs()[0].data.labels).toEqual(["Renamed", "Sample B"]);
  });

  it("the auto Y title follows a source quantity change; a typed one stays", async () => {
    await plotSelectedTogether(["a", "b"]);
    expect(useApp.getState().yAxisLabel).toBe("Y (V)");
    const rename = (labels: string[]) => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" || d.id === "b" ? { ...d, data: { ...d.data, labels } } : d)) }));
      flushLinkedCurves();
    };
    rename(["Moment"]);
    expect(useApp.getState().yAxisLabel).toBe("Moment (V)");
    useApp.setState({ yAxisLabel: "typed by me" });
    rename(["Other"]);
    expect(useApp.getState().yAxisLabel).toBe("typed by me");
  });

  it("names new graphs Graph1, Graph2, ... unique among the Library", async () => {
    await plotSelectedTogether(["a", "b"]);
    expect(graphs().map((g) => g.name)).toEqual(["Graph1"]);
    await plotSelectedTogether(["a", "b"]);
    expect(graphs().map((g) => g.name)).toEqual(["Graph1", "Graph2"]);
    useApp.setState((s) => ({ datasets: [...s.datasets, plain("x", "Graph3", [1])] }));
    await plotSelectedTogether(["a", "b"]);
    expect(graphs().map((g) => g.name)).toEqual(["Graph1", "Graph2", "Graph4"]);
  });
});
