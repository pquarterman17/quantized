import { describe, expect, it } from "vitest";

import { hitTestRoiHandles, quickFitPlugin } from "./uplotGadgets";

describe("hitTestRoiHandles", () => {
  it("hits the left edge within tolerance", () => {
    expect(hitTestRoiHandles(100, 200, 103)).toBe("left");
    expect(hitTestRoiHandles(100, 200, 97)).toBe("left");
  });

  it("hits the right edge within tolerance", () => {
    expect(hitTestRoiHandles(100, 200, 204)).toBe("right");
  });

  it("hits move for a pointer strictly inside the band", () => {
    expect(hitTestRoiHandles(100, 200, 150)).toBe("move");
  });

  it("returns null outside the band + tolerance", () => {
    expect(hitTestRoiHandles(100, 200, 50)).toBeNull();
    expect(hitTestRoiHandles(100, 200, 250)).toBeNull();
  });

  it("prefers the left edge on a tie for a very narrow band", () => {
    // edges 3px apart, both within the default 6px tolerance of the pointer
    expect(hitTestRoiHandles(100, 103, 101)).toBe("left");
  });

  it("respects a custom tolerance", () => {
    // 92 is outside [100,200] and 8px from the left edge — beyond the default
    // 6px tolerance (null) but within a widened 10px tolerance ("left").
    expect(hitTestRoiHandles(100, 200, 92)).toBeNull();
    expect(hitTestRoiHandles(100, 200, 92, 10)).toBe("left");
  });
});

/** Minimal uPlot stub for the draw hook: a recording 2D context + linear
 *  valToPos (mirrors uplotOverlays.test.ts's fakeU). */
function fakeU(dataX: (number | null)[] = [0, 10]) {
  const fills: { x: number; y: number; w: number; h: number }[] = [];
  const strokes: { from: [number, number]; to: [number, number] }[] = [];
  let pen: [number, number] = [0, 0];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    rect() {},
    stroke() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h });
    },
    moveTo(x: number, y: number) {
      pen = [x, y];
    },
    lineTo(x: number, y: number) {
      strokes.push({ from: pen, to: [x, y] });
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };
  const valToPos = (v: number) => v; // identity — x px === x data here
  const u = { ctx, bbox: { left: 0, top: 0, width: 100, height: 50 }, valToPos, data: [dataX] };
  return { u, fills, strokes };
}

function draw(roi: [number, number] | null) {
  const { u, fills, strokes } = fakeU();
  const plugin = quickFitPlugin(roi, "#abc", "#def");
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.draw?.(u);
  return { fills, strokes };
}

describe("quickFitPlugin draw hook", () => {
  it("draws nothing when there is no committed roi", () => {
    const { fills, strokes } = draw(null);
    expect(fills).toHaveLength(0);
    expect(strokes).toHaveLength(0);
  });

  it("shades the band and strokes both edges for a committed roi", () => {
    const { fills, strokes } = draw([20, 60]);
    expect(fills).toEqual([{ x: 20, y: 0, w: 40, h: 50 }]);
    // two vertical edges: (20,0)->(20,50) and (60,0)->(60,50)
    expect(strokes).toEqual([
      { from: [20, 0], to: [20, 50] },
      { from: [60, 0], to: [60, 50] },
    ]);
  });

  it("orders reversed endpoints before drawing", () => {
    const { fills } = draw([60, 20]);
    expect(fills).toEqual([{ x: 20, y: 0, w: 40, h: 50 }]);
  });

  it("clips the shaded band to the plot area", () => {
    const { fills } = draw([-50, 60]); // left edge off-canvas (bbox left=0)
    expect(fills).toEqual([{ x: 0, y: 0, w: 60, h: 50 }]);
  });
});
