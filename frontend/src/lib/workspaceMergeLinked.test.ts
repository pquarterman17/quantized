// Review finding 2: appending a .dwk must carry a graph's curve references
// through the same id remap as every other cross-dataset ref (bgRef, sheet
// refs). Pass 2 used to leave `linkedCurves[].datasetId` on the INCOMING id,
// which on a collision names a DIFFERENT, existing dataset -- a silent rebind.

import { describe, expect, it } from "vitest";

import { relinkedDatasets } from "../store/linkedCurvesSync";
import { assembleLinkedCurves } from "./linkedCurves";
import type { Dataset, LinkedCurve } from "./types";
import { mergeWorkspace } from "./workspaceMerge";

const plain = (id: string, name: string, y: number[]): Dataset => ({
  id,
  name,
  data: { time: [1, 2, 3], values: y.map((v) => [v]), labels: ["Y"], units: ["V"], metadata: {} },
});
const merge = (current: Dataset[], incoming: Dataset[]) => {
  let n = 0;
  return mergeWorkspace(current, { datasets: incoming, workbooks: [] } as never, () => `fresh-${++n}`, new Set(), () => "wb", []);
};
const graphOver = (curves: LinkedCurve[], sources: Dataset[]): Dataset => ({
  id: "g",
  name: "Graph1",
  data: assembleLinkedCurves(curves, sources),
  linkedCurves: curves,
});

describe("append .dwk keeps a graph bound to ITS sources", () => {
  it("remaps the curve's datasetId when the incoming source id collides", () => {
    const incomingA = plain("a", "Sample A", [100, 200, 300]);
    const curves = [{ datasetId: "a", xKey: null, yKey: 0, label: "A" }];
    const out = merge([plain("a", "Other", [-1, -2, -3])], [incomingA, graphOver(curves, [incomingA])]);
    const graph = out.datasets.find((d) => d.linkedCurves)!;
    const newA = out.datasets.find((d) => d.name === "Sample A")!;
    expect(newA.id).not.toBe("a");
    expect(graph.linkedCurves![0].datasetId).toBe(newA.id);
    const rebuilt = relinkedDatasets(out.datasets)!.find((d) => d.linkedCurves)!;
    expect(rebuilt.data.values.map((r) => r[0])).toEqual([100, 200, 300]);
  });

  it("a curve whose source was not part of the appended project draws empty (never the existing dataset)", () => {
    const missing = plain("a", "Gone", [100, 200, 300]);
    const curves = [{ datasetId: "a", xKey: null, yKey: 0, label: "A" }];
    const out = merge([plain("a", "Existing", [-1, -2, -3])], [graphOver(curves, [missing])]);
    const graph = out.datasets.find((d) => d.linkedCurves)!;
    expect(graph.linkedCurves![0].datasetId).not.toBe("a");
    const rebuilt = relinkedDatasets(out.datasets)!.find((d) => d.linkedCurves)!;
    expect(rebuilt.data.values.every((r) => r.every(Number.isNaN))).toBe(true);
    expect(rebuilt.linkedCurves).toHaveLength(1);
  });
});
