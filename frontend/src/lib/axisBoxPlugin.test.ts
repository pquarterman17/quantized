// Plot audit round 2: with the dash cycle on, the axis box drew DASHED — the
// frame inherited whatever line dash the last series left on the shared
// canvas context. The frame is always a solid rectangle.
import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { axisBoxPlugin } from "./uplotOverlays";

describe("axisBoxPlugin", () => {
  it("strokes a solid frame even after a dashed series", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.setLineDash([2, 4]); // the last series drawn was dotted
    let dashAtStroke: number[] | null = null;
    ctx.strokeRect = () => {
      dashAtStroke = ctx.getLineDash();
    };
    const u = { ctx, bbox: { left: 10, top: 10, width: 100, height: 80 } } as unknown as uPlot;
    const draw = axisBoxPlugin("#888").hooks.draw as (u: uPlot) => void;
    draw(u);
    expect(dashAtStroke).toEqual([]);
    // ...and restores the context for whatever draws next.
    expect(ctx.getLineDash()).toEqual([2, 4]);
  });
});
