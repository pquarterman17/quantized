// Whiskers on points a log axis cannot draw (value <= 0) must not draw: their
// pixel is +/-Infinity, so the bar used to dangle to the bottom of the plot.

import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { drawErrorBars, drawErrorSpans } from "./uplotErrorDraw";

function fake(distr: number) {
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    setLineDash: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    strokeStyle: "", lineWidth: 1,
  };
  const u = {
    ctx,
    bbox: { left: 0, top: 0, width: 100, height: 100 },
    data: [[1, 2, 3], [5, -2, 6]],
    series: [{}, { scale: "y", show: true }],
    scales: { x: { distr: 1 }, y: { distr } },
    valToPos: (v: number) => (v > 0 || distr !== 3 ? v : -Infinity),
  } as unknown as uPlot;
  return { u, ctx };
}

describe("error bars on a log axis", () => {
  it("skip the point with a non-positive value (symmetric bars)", () => {
    const { u, ctx } = fake(3);
    drawErrorBars(u, new Map([[1, [0.5, 0.5, 0.5]]]), "#000", 3);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it("skip the point with a non-positive value (spans)", () => {
    const { u, ctx } = fake(3);
    drawErrorSpans(u, new Map([[1, [{ axis: "y", plus: [1, 1, 1], minus: [1, 1, 1] }]]]), "#000", 3);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it("still draw every bar on a linear axis", () => {
    const { u, ctx } = fake(1);
    drawErrorBars(u, new Map([[1, [0.5, 0.5, 0.5]]]), "#000", 3);
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });
});
