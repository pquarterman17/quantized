// Acceptance #1042: Change Y on a plain dataset's graph. The graph turns live and the
// re-bound curve's legend read "three-channel: Beta" while its neighbours read "Alpha" --
// the dataset-qualified form belongs to a graph built by Plot together. A re-bound curve
// takes the legend scheme of the curve it replaces.

import { beforeEach, describe, expect, it } from "vitest";

import { curveBindingAt } from "../lib/curveRebind";
import type { Dataset } from "../lib/types";
import { rebindCurve } from "./curveRebindApply";
import { useApp } from "./useApp";

const plain: Dataset = {
  id: "p",
  name: "three-channel.csv",
  data: {
    time: [0, 1, 2],
    values: [[1, 5, 2], [2, 4, 3], [3, 3, 4]],
    labels: ["Alpha", "Beta", "Gamma"],
    units: ["", "", ""],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [plain], activeId: "p", selectedIds: [], workbooks: [], history: [], future: [],
    xKey: null, yKeys: [0, 1, 2], seriesLabels: {}, hiddenChannels: [], seriesStyles: {},
  });
});

describe("a re-bound curve's legend", () => {
  it("on a plain dataset's graph reads the channel name, like its neighbours", () => {
    const exp = curveBindingAt(useApp.getState(), 2)!;
    expect(rebindCurve(2, exp, { ...exp, yKey: 1 })).toBe(true);
    const graph = useApp.getState().datasets.find((d) => d.linkedCurves)!;
    expect(graph.linkedCurves!.map((c) => c.label)).toEqual(["Alpha", "Beta", "Beta"]);
    expect(graph.linkedCurves![2].labelFrom).toBeUndefined();
  });

  it("on a graph made by Plot together keeps the dataset-qualified form", () => {
    const graph: Dataset = {
      ...plain, id: "g", name: "Graph1",
      linkedCurves: [
        { datasetId: "p", xKey: null, yKey: 0, label: "three-channel.csv: Alpha", labelFrom: "nameCol" },
        { datasetId: "p", xKey: null, yKey: 2, label: "three-channel.csv: Gamma", labelFrom: "nameCol" },
      ],
    };
    useApp.setState({ datasets: [plain, graph], activeId: "g" });
    const exp = curveBindingAt(useApp.getState(), 1)!;
    expect(rebindCurve(1, exp, { ...exp, yKey: 1 })).toBe(true);
    const out = useApp.getState().datasets.find((d) => d.id === "g")!.linkedCurves!;
    expect(out[1]).toMatchObject({ yKey: 1, label: "three-channel.csv: Beta", labelFrom: "nameCol" });
  });
});
