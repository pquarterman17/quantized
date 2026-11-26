// Item 22: a click on the plot picks the nearest DRAWN data point, through the
// lasso channel (a one-vertex outline), on the real store path.

import type uPlot from "uplot";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotPayload } from "./plotdata";
import type { Dataset } from "./types";
import { lassoMask } from "./plotLassoMask";
import { usePickedPoints } from "../store/pickedPoints";
import { useApp } from "../store/useApp";

const ds: Dataset = {
  id: "a", name: "A", data: { time: [0, 1, 2, 3], values: [[5], [6], [7], [8]], labels: ["Y"], units: [""], metadata: {} },
  excludedRows: [3],
};
// 10 px per unit on both axes; y screen = value * 10.
const u = {
  valToPos: (v: number) => v * 10,
  series: [{}, { scale: "y" }],
  scales: { x: { ori: 0 } },
  bbox: { width: 1000, height: 1000 },
} as unknown as uPlot;
const payload = {
  data: [[0, 1, 2, 3], [5, 6, 7, 8]],
  series: [{ label: "Y", unit: "", axis: 0 }],
  xLabel: "X", xUnit: "",
} as unknown as PlotPayload;

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: "a", xKey: null, yKeys: [0], hiddenChannels: [], seriesOrder: [], workbooks: [] });
  usePickedPoints.getState().clear();
});

describe("pickAt via the lasso channel", () => {
  it("picks the point nearest the click, with its source row and values", () => {
    lassoMask(u, payload, [0], ds, [[21, 69]], false); // near (x 2, y 7) -> px (20, 70)
    expect(usePickedPoints.getState().points).toMatchObject([{ datasetId: "a", row: 2, x: 2, y: 7 }]);
  });
  it("picks nothing far from every point, and a repeat adds nothing", () => {
    lassoMask(u, payload, [0], ds, [[500, 500]], false);
    expect(usePickedPoints.getState().points).toHaveLength(0);
    lassoMask(u, payload, [0], ds, [[20, 70]], false);
    lassoMask(u, payload, [0], ds, [[20, 70]], false);
    expect(usePickedPoints.getState().points).toHaveLength(1);
  });
  it("refuses a masked point", () => {
    lassoMask(u, payload, [0], ds, [[30, 80]], false); // row 3 is excluded
    expect(usePickedPoints.getState().points).toHaveLength(0);
  });
  it("a real lasso (3+ vertices) still masks, not picks", () => {
    lassoMask(u, payload, [0], ds, [[0, 0], [100, 0], [100, 100], [0, 100]], false);
    expect(usePickedPoints.getState().points).toHaveLength(0);
  });
});
