import { describe, expect, it } from "vitest";

import type { RefLine } from "./types";
import { refLinePlugin } from "./uplotPlugins";

/** Minimal uPlot stub: a recording 2D context + a linear valToPos. */
function fakeU() {
  const segs: { from: [number, number]; to: [number, number] }[] = [];
  let pen: [number, number] = [0, 0];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    setLineDash() {},
    moveTo(x: number, y: number) {
      pen = [x, y];
    },
    lineTo(x: number, y: number) {
      segs.push({ from: pen, to: [x, y] });
    },
    strokeStyle: "",
    lineWidth: 0,
  };
  // x: identity; y: 100 - value (so y grows downward like a real plot)
  const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
  const u = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos };
  return { u, segs };
}

function draw(lines: RefLine[]) {
  const { u, segs } = fakeU();
  const plugin = refLinePlugin(lines, "#abc");
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.draw?.(u);
  return segs;
}

describe("refLinePlugin", () => {
  it("draws a vertical line for an in-range X reference", () => {
    const segs = draw([{ id: "r1", axis: "x", value: 50 }]);
    expect(segs).toHaveLength(1);
    // vertical: same x, spanning the plot height [top, top+height]
    expect(segs[0]).toEqual({ from: [50, 5], to: [50, 85] });
  });

  it("draws a horizontal line for an in-range Y reference", () => {
    const segs = draw([{ id: "r1", axis: "y", value: 30 }]); // py = 100-30 = 70
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ from: [10, 70], to: [110, 70] });
  });

  it("clips lines outside the plot area", () => {
    const segs = draw([
      { id: "a", axis: "x", value: 999 }, // px 999 > left+width
      { id: "b", axis: "x", value: -5 }, // px -5 < left
    ]);
    expect(segs).toHaveLength(0);
  });

  it("skips non-finite values", () => {
    expect(draw([{ id: "a", axis: "x", value: Number.NaN }])).toHaveLength(0);
  });
});
