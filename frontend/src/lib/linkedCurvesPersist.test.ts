// Gap audit 2 #1: a live graph survives the .dwk -- its curve list round-trips
// (a malformed curve keeps its slot, review finding 9), nothing that edits or
// re-derives its columns comes back with it, and appending a .dwk re-points
// its curves at the merged sources' fresh ids (review finding 2).

import { describe, expect, it } from "vitest";

import { UNRESOLVED_SOURCE } from "./linkedCurvesSanitize";
import type { Dataset } from "./types";
import { parseWorkspace } from "./workspace";
import { mergeWorkspace } from "./workspaceMerge";
import { serializeWorkspace } from "./workspaceSerialize";

const src = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata: {} },
});
const graph: Dataset = {
  id: "g",
  name: "Graph1",
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata: { linked_curve_legends: ["a"] } },
  linkedCurves: [{ datasetId: "a", xKey: null, yKey: 0 }, { datasetId: "b", xKey: null, yKey: 0, label: "mine" }],
};

describe("live graph .dwk round trip", () => {
  it("keeps the curve list", () => {
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [src("a"), src("b"), graph] })).datasets;
    expect(loaded.find((d) => d.id === "g")!.linkedCurves).toEqual(graph.linkedCurves);
  });

  it("a malformed curve keeps its slot; formulas/corrections never ride a graph", () => {
    const text = serializeWorkspace({ datasets: [src("a"), graph] });
    const doc = JSON.parse(text) as { datasets: Record<string, unknown>[] };
    const g = doc.datasets.find((d) => d.id === "g")!;
    g.linkedCurves = [{ datasetId: "a" }, { datasetId: "a", xKey: null, yKey: 0 }];
    g.formulas = [{ name: "k", expr: "A*2" }];
    g.corrections = { xOff: 1 };
    const loaded = parseWorkspace(JSON.stringify(doc)).datasets.find((d) => d.id === "g")!;
    expect(loaded.linkedCurves).toEqual([
      { datasetId: "a", xKey: null, yKey: -1 },
      { datasetId: "a", xKey: null, yKey: 0 },
    ]);
    expect(loaded.formulas).toBeUndefined();
    expect(loaded.corrections).toBeUndefined();
  });
});

describe("appending a .dwk that holds a graph", () => {
  it("re-points the curves at the merged ids; a source the file lacks draws empty", () => {
    const incoming = parseWorkspace(serializeWorkspace({ datasets: [src("a"), graph] }));
    // "a" collides with a dataset already open, so the incoming one is renamed.
    let n = 0;
    const out = mergeWorkspace([src("a")], incoming, () => `fresh-${++n}`, new Set(), () => `wb-${++n}`);
    const merged = out.datasets.find((d) => d.linkedCurves)!;
    const newA = out.datasets.slice(1).find((d) => !d.linkedCurves)!; // after `current`
    expect(newA.id).not.toBe("a");
    expect(merged.linkedCurves!.map((c) => c.datasetId)).toEqual([newA.id, UNRESOLVED_SOURCE]);
  });
});
