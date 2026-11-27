// Acceptance 7 C1: a text symbol on the first or last point is drawn whole, not clipped by the plot frame
// (the SVG draws it whole); a point outside the plot area still draws nothing.

import { describe, expect, it, vi } from "vitest";

import { textSymbolPlugins } from "./uplotTextSymbols";

function draw(xs: number[], ys: number[]) {
  const ctx = { save: vi.fn(), restore: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), fillText: vi.fn(), textAlign: "", textBaseline: "", fillStyle: "", font: "" };
  const u = {
    ctx, bbox: { left: 100, top: 50, width: 400, height: 300 },
    data: [xs, ys], series: [{}, { scale: "y", stroke: "#f00" }],
    valToPos: (v: number, scale: string) => (scale === "x" ? 100 + v * 40 : 350 - v * 30),
  };
  const plugin = textSymbolPlugins([{ markerText: "aa" }])[0];
  (plugin.hooks.draw as (u: unknown) => void)(u);
  return ctx;
}

describe("text symbols at the plot edge", () => {
  it("draws the first and last points whole (no clip) and skips a point outside the plot area", () => {
    const ctx = draw([0, 5, 10, 12], [0, 5, 10, 3]); // x 0 -> left edge, x 10 -> right edge, x 12 -> past it; y 0 / 10 -> bottom / top
    expect(ctx.clip).not.toHaveBeenCalled();
    expect(ctx.fillText.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([["aa", 100, 350], ["aa", 300, 200], ["aa", 500, 50]]);
  });
});
