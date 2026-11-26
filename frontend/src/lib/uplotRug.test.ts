import { describe, expect, it } from "vitest";
import type uPlot from "uplot";

import type { SeriesStyle } from "./seriesStyleTypes";
import { rugPlugins } from "./uplotRug";

/** A minimal uPlot stand-in that records every moveTo/lineTo of the draw hook. */
function drawWith(style: SeriesStyle, ys: (number | null)[]) {
  const segs: { op: string; x: number; y: number }[] = [];
  const state = { alpha: 1, strokes: [] as number[] };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => segs.push({ op: k, x, y });
      if (k === "stroke") return () => state.strokes.push(state.alpha);
      return () => {};
    },
    set(_t, k: string, v) {
      if (k === "globalAlpha") state.alpha = v as number;
      return true;
    },
  });
  const u = {
    ctx, bbox: { left: 10, top: 20, width: 200, height: 100 }, data: [[1, 2, 3, 4], [...ys]],
    series: [{}, { stroke: "#123456", scale: "y" }],
    valToPos: (v: number) => v * 10,
  } as unknown as uPlot;
  const [plugin] = rugPlugins([style]);
  (plugin.hooks.draw as (u: uPlot) => void)(u);
  return { segs, strokes: state.strokes };
}

describe("rugPlugins", () => {
  it("is empty without a rug", () => {
    expect(rugPlugins([{}, undefined])).toEqual([]);
  });
  it("draws an X tick per finite point, rising from the bottom edge", () => {
    const { segs, strokes } = drawWith({ rug: "x", rugLength: 0.1, rugOpacity: 0.3 }, [5, null, 7, 9]);
    expect(segs.filter((s) => s.op === "moveTo")).toHaveLength(3); // the null-y row has no point
    expect(segs[0]).toEqual({ op: "moveTo", x: 10, y: 120 });
    expect(segs[1]).toEqual({ op: "lineTo", x: 10, y: 110 }); // 0.1 of the 100 px height
    expect(strokes).toEqual([0.3]);
  });
  it("both axes draw Y ticks inward from the left edge, 0.12 of the width", () => {
    const { segs } = drawWith({ rug: "both", rugLength: 0.12 }, [5, 6, 7, 8]);
    expect(segs).toHaveLength(16);
    expect(segs.filter((s) => s.op === "lineTo" && s.x === 34)).toHaveLength(4);
  });
  it("an out-of-range length or opacity falls back to the defaults", () => {
    const { strokes } = drawWith({ rug: "x", rugLength: 5, rugOpacity: 0 }, [1, 2, 3, 4]);
    expect(strokes).toEqual([0.5]);
  });
});
