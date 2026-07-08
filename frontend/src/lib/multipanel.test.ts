import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { cellSize, facetGridSize, panelHeights, splitPayload, xZoomSyncHook } from "./multipanel";
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

describe("facetGridSize", () => {
  it("tiles a perfect square exactly", () => {
    expect(facetGridSize(4)).toEqual({ rows: 2, cols: 2 });
    expect(facetGridSize(9)).toEqual({ rows: 3, cols: 3 });
  });

  it("rounds up to a wider grid for a non-square count", () => {
    expect(facetGridSize(5)).toEqual({ rows: 2, cols: 3 });
    expect(facetGridSize(7)).toEqual({ rows: 3, cols: 3 });
  });

  it("handles n=1", () => {
    expect(facetGridSize(1)).toEqual({ rows: 1, cols: 1 });
  });

  it("falls back to 1x1 for a degenerate count", () => {
    expect(facetGridSize(0)).toEqual({ rows: 1, cols: 1 });
    expect(facetGridSize(-3)).toEqual({ rows: 1, cols: 1 });
  });
});

describe("cellSize", () => {
  it("divides a 2x2 grid evenly minus the gaps", () => {
    // (400 - 8) / 2 = 196 wide, (300 - 8) / 2 = 146 tall.
    expect(cellSize(400, 300, { rows: 2, cols: 2 }, 8)).toEqual({ cellW: 196, cellH: 146 });
  });

  it("defaults the gap to 8px", () => {
    expect(cellSize(400, 300, { rows: 2, cols: 2 })).toEqual({ cellW: 196, cellH: 146 });
  });

  it("a 1x1 grid ignores the gap entirely", () => {
    expect(cellSize(400, 300, { rows: 1, cols: 1 }, 8)).toEqual({ cellW: 400, cellH: 300 });
  });

  it("never goes below 1px in either dimension", () => {
    expect(cellSize(5, 5, { rows: 3, cols: 3 }, 8)).toEqual({ cellW: 1, cellH: 1 });
  });
});

describe("xZoomSyncHook", () => {
  function fakePlot(min: number | null, max: number | null) {
    return { scales: { x: { min, max } }, setScale: vi.fn() };
  }

  it("propagates the triggering panel's x range to every OTHER panel", () => {
    const a = fakePlot(1, 5);
    const b = fakePlot(0, 0);
    const c = fakePlot(0, 0);
    const plots = [a, b, c];
    const hook = xZoomSyncHook(() => plots as unknown as uPlot[]);
    hook(a as unknown as uPlot, "x");
    expect(b.setScale).toHaveBeenCalledWith("x", { min: 1, max: 5 });
    expect(c.setScale).toHaveBeenCalledWith("x", { min: 1, max: 5 });
    expect(a.setScale).not.toHaveBeenCalled();
  });

  it("ignores a non-x scale key", () => {
    const a = fakePlot(1, 5);
    const b = fakePlot(0, 0);
    const hook = xZoomSyncHook(() => [a, b] as unknown as uPlot[]);
    hook(a as unknown as uPlot, "y");
    expect(b.setScale).not.toHaveBeenCalled();
  });

  it("ignores an incomplete range (min or max not yet resolved)", () => {
    const a = fakePlot(null, 5);
    const b = fakePlot(0, 0);
    const hook = xZoomSyncHook(() => [a, b] as unknown as uPlot[]);
    hook(a as unknown as uPlot, "x");
    expect(b.setScale).not.toHaveBeenCalled();
  });

  it("guards re-entrancy: propagating to panel B doesn't loop back through A", () => {
    const a = fakePlot(1, 5);
    const b = fakePlot(0, 0);
    const plots = [a, b];
    const hook = xZoomSyncHook(() => plots as unknown as uPlot[]);
    // Simulate real uPlot behaviour: calling .setScale on a panel that shares
    // this SAME hook re-invokes it — exactly what would infinite-loop without
    // the closed-over `syncing` guard.
    b.setScale.mockImplementation(() => hook(b as unknown as uPlot, "x"));
    expect(() => hook(a as unknown as uPlot, "x")).not.toThrow();
    expect(b.setScale).toHaveBeenCalledTimes(1);
  });
});
