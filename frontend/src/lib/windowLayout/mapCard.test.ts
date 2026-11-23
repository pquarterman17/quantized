// Which dataset the Style window's 2-D map card describes (UX pass 4 M2).
import { describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../plotview";
import type { Dataset } from "../types";
import { dock, emptyLayout } from "./ops";
import { mapCardDatasetId } from "./mapCard";

const ds = (id: string): Dataset => ({ id, name: `${id}.xrdml`, data: { time: [0], values: [[0]], labels: ["a"], units: [""], metadata: {} } });
const win = (id: string, kind: PlotWindow["kind"], datasetId: string, z: number, winState: PlotWindow["winState"] = "normal"): PlotWindow => ({
  id, kind, title: id, datasetId, geometry: { x: 0, y: 0, w: 300, h: 200 }, z, winState, view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});
const layoutOf = (...ids: string[]) => ids.reduce((l, id) => dock(l, `plot:${id}`, "centre"), emptyLayout());
const datasets = [ds("a"), ds("b"), ds("cut")];

describe("mapCardDatasetId", () => {
  it("is the front-most map window's dataset, wherever the Library's active dataset is", () => {
    const wins = [win("p", "plot", "a", 1), win("m1", "map", "a", 2), win("m2", "map", "b", 3)];
    expect(mapCardDatasetId(wins, datasets, "a", layoutOf("p", "m1", "m2"))).toBe("b");
    const raised = [win("p", "plot", "a", 1), win("m1", "map", "a", 4), win("m2", "map", "b", 3)];
    expect(mapCardDatasetId(raised, datasets, "b", layoutOf("p", "m1", "m2"))).toBe("a");
  });

  it("stays on the map while a cut dataset (an H-cut) is the active one", () => {
    const wins = [win("p", "plot", "a", 1), win("m1", "map", "a", 2)];
    expect(mapCardDatasetId(wins, datasets, "cut", layoutOf("p", "m1"))).toBe("a");
  });

  it("with a plot in front, the active dataset's own map window (else none)", () => {
    const wins = [win("m1", "map", "a", 1), win("m2", "map", "b", 2), win("p", "plot", "a", 3)];
    expect(mapCardDatasetId(wins, datasets, "a", layoutOf("p", "m1", "m2"))).toBe("a");
    expect(mapCardDatasetId(wins, datasets, "cut", layoutOf("p", "m1", "m2"))).toBeNull();
  });

  it("ignores a minimized or closed map window, and a dataset that is gone", () => {
    expect(mapCardDatasetId([win("m1", "map", "a", 1, "minimized")], datasets, "a", layoutOf("m1"))).toBeNull();
    expect(mapCardDatasetId([win("m1", "map", "a", 1)], datasets, "a", emptyLayout())).toBeNull();
    expect(mapCardDatasetId([win("m1", "map", "gone", 1)], datasets, "gone", layoutOf("m1"))).toBeNull();
    expect(mapCardDatasetId([], datasets, "a", null)).toBeNull();
  });
});
