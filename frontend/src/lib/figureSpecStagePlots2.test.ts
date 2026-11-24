import { afterEach, describe, expect, it } from "vitest";

import { buildStageFigureSpec, PLOTS2_EXPORT_REFUSAL } from "./figureSpecStage";
import { setPlots2Mode } from "./plots2Mode";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";

const ds = {
  id: "d1",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: [""], metadata: {} },
} as unknown as Dataset;

describe("File > Export figure with a G15 view open", () => {
  afterEach(() => setPlots2Mode(null));

  it("refuses with a pointer to the plot's own Export instead of exporting the XY plot", () => {
    setPlots2Mode("blandAltman");
    expect(() => buildStageFigureSpec(() => useApp.getState(), ds, "d", {} as never)).toThrow(PLOTS2_EXPORT_REFUSAL);
  });

  it("does not refuse once the view is back on the XY plot", () => {
    setPlots2Mode("pareto");
    setPlots2Mode(null);
    expect(() => buildStageFigureSpec(() => useApp.getState(), ds, "d", {} as never)).not.toThrow(PLOTS2_EXPORT_REFUSAL);
  });
});
