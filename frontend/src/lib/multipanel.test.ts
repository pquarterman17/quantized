import { describe, expect, it } from "vitest";

import { panelHeights, splitPayload } from "./multipanel";
import type { PlotPayload } from "./plotdata";

const PAYLOAD: PlotPayload = {
  data: [
    [0, 1, 2],
    [10, 20, 30],
    [100, 200, 300],
  ],
  series: [
    { label: "A", unit: "V", axis: 0 },
    { label: "B", unit: "A", axis: 0 },
  ],
  xLabel: "T",
  xUnit: "s",
};

describe("splitPayload", () => {
  it("makes one single-series payload per channel, sharing x", () => {
    const panels = splitPayload(PAYLOAD);
    expect(panels).toHaveLength(2);
    expect(panels[0].data).toEqual([
      [0, 1, 2],
      [10, 20, 30],
    ]);
    expect(panels[0].series).toEqual([{ label: "A", unit: "V", axis: 0 }]);
    expect(panels[1].data).toEqual([
      [0, 1, 2],
      [100, 200, 300],
    ]);
    expect(panels[1].series[0].label).toBe("B");
    // x metadata carries to every panel.
    expect(panels[0].xLabel).toBe("T");
    expect(panels[1].xUnit).toBe("s");
  });

  it("returns an empty list for no series", () => {
    expect(splitPayload({ ...PAYLOAD, data: [[0, 1, 2]], series: [] })).toEqual([]);
  });
});

describe("panelHeights", () => {
  it("divides the height evenly minus the gaps", () => {
    // 3 panels, 400 px, 8 px gaps -> (400 - 16) / 3 = 128 each.
    expect(panelHeights(3, 400, 8)).toEqual([128, 128, 128]);
  });

  it("never goes below 1 px", () => {
    expect(panelHeights(10, 5, 8)).toEqual(new Array(10).fill(1));
  });

  it("handles the degenerate count", () => {
    expect(panelHeights(0, 400)).toEqual([]);
  });
});
