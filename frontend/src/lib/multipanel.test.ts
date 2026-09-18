import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import {
  breakPanelWidths,
  cellSize,
  facetGridSize,
  panelHeights,
  spatialCellStyling,
  spatialPlottedChannels,
  splitPayload,
  xZoomSyncHook,
} from "./multipanel";
import type { PlotPayload } from "./plotdata";
import type { SeriesStyle } from "./types";

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

// Item A (PNR.opj Book14 Graph11 repro): the spatial multi-panel path has no
// per-panel legend to toggle a hidden channel back on (unlike the
// single-plot path's `hidden` boolean array), so a "Y-error"-designated
// column is dropped from the plotted set outright.
describe("spatialPlottedChannels", () => {
  it("drops hidden channels from yKeys", () => {
    expect(spatialPlottedChannels({ yKeys: [0, 1, 2], hiddenChannels: [1] })).toEqual([0, 2]);
  });

  it("passes yKeys through unchanged when there are no hidden channels", () => {
    expect(spatialPlottedChannels({ yKeys: [0, 1], hiddenChannels: [] })).toEqual([0, 1]);
    expect(spatialPlottedChannels({ yKeys: [0, 1] })).toEqual([0, 1]); // hiddenChannels absent entirely
  });

  it("can drop every channel (all designated hidden)", () => {
    expect(spatialPlottedChannels({ yKeys: [1], hiddenChannels: [1] })).toEqual([]);
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

describe("breakPanelWidths", () => {
  it("divides width evenly minus glyph gutters between panels", () => {
    // 3 panels, 600px, 20px gutters -> (600 - 2*20)/3 = 186.67 -> floor 186 each.
    expect(breakPanelWidths(3, 600, 20)).toEqual([186, 186, 186]);
  });

  it("a single panel gets the full width (no gutters)", () => {
    expect(breakPanelWidths(1, 600, 20)).toEqual([600]);
  });

  it("defaults the glyph width to 20px", () => {
    expect(breakPanelWidths(2, 440)).toEqual([210, 210]);
  });

  it("never goes below 1px", () => {
    expect(breakPanelWidths(5, 10, 20)).toEqual(new Array(5).fill(1));
  });

  it("handles the degenerate count", () => {
    expect(breakPanelWidths(0, 600)).toEqual([]);
    expect(breakPanelWidths(-2, 600)).toEqual([]);
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

// ── P3.3: the spatial cell's styling, canvas + legend from ONE derivation ───
// `useMultiPanelStage.ts` builds a cell's uPlot options from `cellStyles` +
// `cellCycle` and portals `legendEntries` beside it. Deriving them apart is how
// the legend ended up showing a solid swatch next to a dashed curve; deriving
// them here makes that unrepresentable, and pins it.
describe("spatialCellStyling (P3.3)", () => {
  const panel = {
    yKeys: [1, 2, 3],
    seriesLabels: { 1: "A", 2: "B", 3: "C" },
    seriesStyles: {} as Record<number, SeriesStyle>,
  };

  it("OFF: no cycle, and the legend carries the raw stored style", () => {
    const out = spatialCellStyling(panel, false);
    expect(out.cellCycle).toBeNull();
    expect(out.legendEntries.map((e) => e.style)).toEqual([undefined, undefined, undefined]);
  });

  it("ON: the legend swatch carries the SAME resolved style the cell canvas gets", () => {
    const out = spatialCellStyling(panel, true);
    expect(out.cellStyles).toEqual([undefined, undefined, undefined]); // canvas gets RAW…
    expect(out.cellCycle).toEqual([0, 1, 2]); // …plus these positions
    // …so the swatch must show what `buildOpts` will resolve from that pair.
    expect(out.legendEntries.map((e) => e.style?.line)).toEqual(["solid", "dashed", "dotted"]);
    expect(out.legendEntries.map((e) => e.displayIndex)).toEqual([0, 1, 2]);
  });

  it("hidden channels drop out of BOTH the positions and the legend", () => {
    // `spatialPlottedChannels` filters hidden for the canvas AND for
    // `spatialPageExport`'s request, so unlike the single-figure path there is
    // no unfiltered list to reconcile — the cycle is plain display order over
    // what survives, on every side.
    const out = spatialCellStyling({ ...panel, hiddenChannels: [2] }, true);
    expect(out.plottedChannels).toEqual([1, 3]);
    expect(out.cellCycle).toEqual([0, 1]);
    expect(out.legendEntries.map((e) => e.label)).toEqual(["A", "C"]);
    expect(out.legendEntries.map((e) => e.style?.line)).toEqual(["solid", "dashed"]);
  });

  it("an unlabelled channel takes a cycle position but no legend row", () => {
    // `flatMap` drops the entry; the POSITION still belongs to that channel, so
    // the labelled ones must not slide up to fill the gap.
    const out = spatialCellStyling({ ...panel, seriesLabels: { 1: "A", 3: "C" } }, true);
    expect(out.legendEntries.map((e) => e.displayIndex)).toEqual([0, 2]);
    expect(out.legendEntries.map((e) => e.style?.line)).toEqual(["solid", "dotted"]);
  });

  it("an explicit per-series style still wins in the legend", () => {
    const out = spatialCellStyling({ ...panel, seriesStyles: { 2: { line: "solid" } } }, true);
    expect(out.legendEntries.map((e) => e.style?.line)).toEqual(["solid", "solid", "dotted"]);
  });
});
