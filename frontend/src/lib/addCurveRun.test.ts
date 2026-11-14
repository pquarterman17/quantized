// Gap audit 2 #1: "Add curve from…" adds a LIVE curve to the active graph, or
// starts a graph from the active plot. A source whose curves reach the target
// (transitively, the target itself included) is refused -- it is not even
// offered -- so a graph cycle can never be made here (review finding 1).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ParamField } from "./params";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";
import { addCurveFrom, commitCurve } from "./addCurveRun";

const asked: { title: string; fields: ParamField[] }[] = [];
let answers: Record<string, unknown>[] = [];
vi.mock("../store/paramDialog", () => ({
  askParams: (title: string, fields: ParamField[]) => {
    asked.push({ title, fields });
    return Promise.resolve(answers.shift() ?? null);
  },
}));

const src = (id: string): Dataset => ({
  id, name: id.toUpperCase(),
  data: { time: [0, 1], values: [[1, 10], [2, 20]], labels: ["P", "Q"], units: ["", ""], metadata: {} },
});
const graph = (id: string, ...sources: string[]): Dataset => ({
  id, name: id, data: { time: [], values: [], labels: [], units: [], metadata: {} },
  linkedCurves: sources.map((datasetId) => ({ datasetId, xKey: null, yKey: 0 })),
});
const get = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;

beforeEach(() => {
  asked.length = 0;
  answers = [];
  useApp.setState({
    datasets: [src("a"), src("b"), graph("g1", "a"), graph("g2", "g1")],
    activeId: "g1", xKey: null, yKeys: null, seriesOrder: null, hiddenChannels: [], history: [],
  });
});

describe("Add curve from…", () => {
  it("adds the picked curve to the active graph", async () => {
    answers = [{ source: "2: B" }, { y: "B: Q", x: "its own X" }];
    await addCurveFrom();
    expect(get("g1").linkedCurves).toEqual([
      { datasetId: "a", xKey: null, yKey: 0 },
      { datasetId: "b", xKey: null, yKey: 1 },
    ]);
  });

  it("never offers the graph itself or a graph built from it", async () => {
    await addCurveFrom(); // cancelled at the first step
    const offered = asked[0].fields[0].options!;
    expect(offered).toEqual(["1: A", "2: B"]); // not g1 (itself), not g2 (sources g1)
  });

  it("a commit that would close a cycle is refused against the CURRENT store", () => {
    expect(commitCurve("g1", null, { datasetId: "g2", xKey: null, yKey: 0 })).toBe(false);
    expect(get("g1").linkedCurves).toHaveLength(1);
  });

  it("on a plain dataset it starts a new live graph from the shown curves, each on its own X", () => {
    const sheet: Dataset = {
      id: "s", name: "S",
      data: { time: [0, 1], values: [[3, 30, 33], [1, 10, 11]], labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} },
      columnDesignations: { 1: "X" },
    };
    useApp.setState((st) => ({ datasets: [...st.datasets, sheet], activeId: "s", xKey: 1, hiddenChannels: [1] }));
    expect(commitCurve(null, sheet, { datasetId: "a", xKey: null, yKey: 0 })).toBe(true);
    const created = useApp.getState().datasets.find((d) => d.name === "Graph1")!;
    expect(created.linkedCurves).toEqual([
      { datasetId: "s", xKey: null, yKey: 0 }, // R1 on its own X (T1), not the plot's T2
      { datasetId: "s", xKey: null, yKey: 2 },
      { datasetId: "a", xKey: null, yKey: 0 },
    ]);
    expect(useApp.getState().activeId).toBe(created.id);
  });
});
