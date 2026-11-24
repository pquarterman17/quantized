// UX menus audit M4: a 2-D map dataset's Library row offers "Open map" and
// "Map operations…"; a 1-D dataset's row does not.

import { beforeEach, describe, expect, it } from "vitest";

import { useAnalysisExtras } from "../store/analysisExtras";
import { useApp } from "../store/useApp";
import { buildMenuItems, type DatasetActionTarget } from "./contextActions";
import { datasetCoreActions } from "./datasetContextActions";
import type { Dataset } from "./types";

const ds = (id: string, is2D: boolean): Dataset => ({
  id, name: id,
  data: { time: [0, 1], values: [[1, 2, 3], [4, 5, 6]], labels: ["x", "y", "z"], units: ["", "", ""], metadata: { is2D } },
} as unknown as Dataset);

const target = (d: Dataset): DatasetActionTarget => ({
  dataset: d, active: false, selected: false, selectedIds: [], canMoveUp: false, canMoveDown: false,
  onRename: () => {}, onAddTag: () => {},
});
const labels = (d: Dataset) => buildMenuItems(datasetCoreActions, target(d)).map((i) => ("label" in i ? i.label : ""));

beforeEach(() => {
  useApp.setState({ datasets: [ds("m", true), ds("p", false)], activeId: "p" });
});

describe("dataset row menu for a map", () => {
  it("lists the map entries for a 2-D map only", () => {
    expect(labels(ds("m", true))).toEqual(expect.arrayContaining(["Open map", "Map operations…"]));
    expect(labels(ds("p", false))).not.toContain("Open map");
    expect(labels(ds("p", false))).not.toContain("Map operations…");
  });

  it("Open map activates the dataset and shows the Map tab", () => {
    const action = datasetCoreActions.find((a) => a.id === "dataset.openMap")!;
    action.run(target(ds("m", true)));
    expect(useApp.getState().activeId).toBe("m");
    expect(useApp.getState().stageTab).toBe("map");
  });

  it("Map operations… opens the map-operations panel on that dataset", () => {
    const action = datasetCoreActions.find((a) => a.id === "dataset.mapOperations")!;
    action.run(target(ds("m", true)));
    expect(useApp.getState().activeId).toBe("m");
    expect(useAnalysisExtras.getState().open).toContain("map-ops");
  });
});
