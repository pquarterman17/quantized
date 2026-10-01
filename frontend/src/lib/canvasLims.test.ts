// The canvas' resolution of committed X/Y limits (`lib/canvasLims.ts`) on a
// LOG axis. A typed side at or below zero cannot be drawn there (uPlot takes
// log10 of the bound), and the export's matplotlib ignores such a side
// (`set_ylim(0, None)` on a log axis keeps its autoscale). So the canvas treats
// it as auto for that side too, half-open or fully typed.

import { describe, expect, it } from "vitest";

import { resolveCanvasLims } from "./canvasLims";
import type { PlotPayload } from "./plotdata";

const payload = {
  data: [
    [1, 2, 3, 4],
    [10, 20, 40, 80],
  ],
  series: [{ label: "S", unit: "" }],
  xLabel: "x",
  xUnit: "",
} as unknown as PlotPayload;

const positive = (r: [number, number] | null) => r === null || (r[0] > 0 && r[1] > 0);

describe("resolveCanvasLims on a log axis", () => {
  it("a half-open pair's non-positive typed side is auto, never a log10(0) bound", () => {
    const r = resolveCanvasLims(payload, { yLim: [0, null], xScale: "linear", yScale: "log" });
    expect(positive(r.y.range)).toBe(true);
  });

  it("a fully typed pair keeps its positive side and drops the non-positive one to auto", () => {
    const r = resolveCanvasLims(payload, { yLim: [-5, 50], xScale: "linear", yScale: "log" });
    expect(r.y.range?.[1]).toBe(50);
    expect(positive(r.y.range)).toBe(true);
  });

  it("an X half-open pair on a log X follows the same rule", () => {
    const r = resolveCanvasLims(payload, { xLim: [null, 0], xScale: "log", yScale: "linear" });
    expect(positive(r.x.range)).toBe(true);
  });

  it("a linear axis keeps a typed zero, and a positive log pair passes through by reference", () => {
    expect(resolveCanvasLims(payload, { yLim: [0, null], xScale: "linear", yScale: "linear" }).y.range?.[0]).toBe(0);
    const fixed: [number, number] = [5, 50];
    expect(resolveCanvasLims(payload, { yLim: fixed, xScale: "linear", yScale: "log" }).y.range).toBe(fixed);
  });
});
