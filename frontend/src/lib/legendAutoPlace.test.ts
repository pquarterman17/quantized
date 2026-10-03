// Plot audit round 2: the "auto" legend sits in the least-occupied corner of
// the plot frame, and measures its outside column for the stage's CSS.
import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { cornerCounts, drawnPoints, NARROW_FRAME, pickCorner, placeLegend } from "./legendAutoPlace";

/** A 400×300 frame whose scales map data 0..100 straight onto it (y up). */
function fakePlot(series: (number | null)[][], xs: number[], show: boolean[] = series.map(() => true)): uPlot {
  return {
    data: [xs, ...series],
    series: [{}, ...series.map((_, i) => ({ show: show[i], scale: "y" }))],
    valToPos: (v: number, key: string) => (key === "x" ? (v / 100) * 400 : 300 - (v / 100) * 300),
    over: { getBoundingClientRect: () => ({ width: 400, height: 300 }) },
  } as unknown as uPlot;
}

describe("cornerCounts / pickCorner", () => {
  it("counts the points under a box in each corner", () => {
    const pts: [number, number][] = [[390, 10], [395, 20], [10, 290]];
    expect(cornerCounts(pts, 400, 300, 100, 50)).toEqual({ ne: 2, nw: 0, se: 0, sw: 1 });
  });

  it("prefers top right on a tie, and keeps the current corner unless another is clearly emptier", () => {
    expect(pickCorner({ ne: 0, nw: 0, se: 0, sw: 0 })).toBe("ne");
    expect(pickCorner({ ne: 40, nw: 3, se: 9, sw: 0 })).toBe("sw");
    expect(pickCorner({ ne: 40, nw: 3, se: 9, sw: 2 }, "nw")).toBe("nw");
    expect(pickCorner({ ne: 40, nw: 30, se: 9, sw: 0 }, "nw")).toBe("sw");
  });
});

describe("drawnPoints", () => {
  it("fills in a sparse line that crosses a corner between its samples", () => {
    // Two samples only, from bottom left to top right: the line still crosses
    // the top-right corner patch, even though neither end is inside it.
    const pts = drawnPoints(fakePlot([[0, 90]], [0, 90]));
    const c = cornerCounts(pts, 400, 300, 150, 100);
    expect(c.ne).toBeGreaterThan(0);
    expect(c.nw).toBe(0);
  });

  it("skips hidden series and gaps", () => {
    const pts = drawnPoints(fakePlot([[50, null, 50], [99, 99, 99]], [0, 50, 100], [true, false]));
    expect(pts.every(([, y]) => y === 150)).toBe(true);
  });
});

describe("placeLegend", () => {
  function stageWith(cls: string, w: number, h: number): HTMLElement {
    const stage = document.createElement("div");
    const box = document.createElement("div");
    box.className = `qzk-legend ${cls}`;
    Object.defineProperty(box, "offsetWidth", { value: w });
    Object.defineProperty(box, "offsetHeight", { value: h });
    stage.appendChild(box);
    return stage;
  }

  it("moves an auto legend off profiles that start in the top right", () => {
    // SIMS-like: every profile starts high at the left... and the right.
    const xs = Array.from({ length: 101 }, (_, i) => i);
    const stage = stageWith("auto", 120, 60);
    placeLegend(fakePlot([xs.map(() => 95), xs.map((x) => (x < 50 ? 90 : 5))], xs), stage);
    expect(stage.dataset.lc).toBe("sw");
  });

  it("publishes an outside column's width for the stage CSS", () => {
    const stage = stageWith("out", 180, 500);
    placeLegend(fakePlot([[1, 2]], [0, 1]), stage);
    expect(stage.style.getPropertyValue("--qz-out-w")).toBe("180px");
    expect(stage.dataset.lc).toBeUndefined();
  });

  it("flags a frame too narrow for the legend's reorder buttons", () => {
    const stage = stageWith("auto", 120, 60);
    const plot = fakePlot([[1, 2]], [0, 1]);
    const narrow = { ...plot, over: { getBoundingClientRect: () => ({ width: NARROW_FRAME - 1, height: 300 }) } };
    placeLegend(narrow as uPlot, stage);
    expect(stage.hasAttribute("data-narrow-frame")).toBe(true);
    placeLegend(plot, stage);
    expect(stage.hasAttribute("data-narrow-frame")).toBe(false);
  });
});
