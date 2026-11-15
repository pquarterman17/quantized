import { beforeEach, describe, expect, it } from "vitest";

import { canRenderMap } from "./mapdata";
import { plotTypeUnavailable } from "./plotTypes";
import { contourFromScattered } from "./scatteredContour";
import { useApp } from "../store/useApp";

const scattered = {
  time: [0.1, 4.2, 2.5, 3.3, 1.7, 0.9, 2.2, 3.9],
  values: [[1.2, 3], [0.4, 5], [3.1, 2], [2.2, 8], [4.0, 1], [3.5, 6], [0.2, 4], [2.9, 7]],
  labels: ["Y", "Z"],
  units: ["", ""],
  metadata: {},
};

describe("Contour from scattered XYZ", () => {
  beforeEach(() => {
    useApp.getState().loadWorkspace({ datasets: [{ id: "d", name: "cloud", data: scattered }], activeId: "d" });
    useApp.setState({ stageTab: "plot" });
  });

  it("opts the focused dataset in and opens its Map tab, as one undo step", () => {
    expect(canRenderMap(useApp.getState().datasets[0].data)).toBe(false);
    contourFromScattered();
    const s = useApp.getState();
    expect(canRenderMap(s.datasets[0].data)).toBe(true);
    expect(s.stageTab).toBe("map");
    s.undo();
    expect(canRenderMap(useApp.getState().datasets[0].data)).toBe(false);
  });

  it("points the contour plot type's refusal at the explicit command", () => {
    expect(plotTypeUnavailable("contour", useApp.getState().datasets[0])).toMatch(/Contour from scattered XYZ/);
  });

  it("refuses a dataset with fewer than three columns and changes nothing", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d", name: "two", data: { ...scattered, values: scattered.values.map((r) => [r[0]]), labels: ["Y"], units: [""] } }],
      activeId: "d",
    });
    contourFromScattered();
    expect(useApp.getState().stageTab).not.toBe("map");
    expect(useApp.getState().datasets[0].data.metadata["scatteredXYZ"]).toBeUndefined();
  });
});
