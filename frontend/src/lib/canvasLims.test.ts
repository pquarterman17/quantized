// The canvas' resolution of committed X/Y limits (`lib/canvasLims.ts`) on a
// LOG or RECIPROCAL axis. A typed side at or below zero cannot be drawn there
// (uPlot takes log10 or 1/x of the bound), and the export ignores such a side
// (matplotlib's log `set_ylim(0, None)` keeps its autoscale; the reciprocal
// axis drops it in `calc/figure_scale.drawable_lim`). So the canvas treats it
// as auto for that side too, half-open or fully typed.

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

describe("resolveCanvasLims on a log or reciprocal axis", () => {
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

  it("reports which axis had a side dropped, for the status note", () => {
    const r = resolveCanvasLims(payload, { yLim: [0, 50], xScale: "linear", yScale: "log" });
    expect(r.y.dropped).toBe(true);
    expect(r.x.dropped).toBe(false);
    expect(resolveCanvasLims(payload, { yLim: [5, 50], xScale: "linear", yScale: "log" }).y.dropped).toBe(false);
  });

  // A reciprocal axis follows the same rule: 1/x of a side <= 0 is undefined,
  // and the export (calc/figure_scale.drawable_lim) drops that side as well.
  it("a reciprocal axis drops a non-positive side to auto and says so", () => {
    const half = resolveCanvasLims(payload, { yLim: [0, null], xScale: "linear", yScale: "reciprocal" });
    expect(positive(half.y.range)).toBe(true);
    expect(half.y.dropped).toBe(true);
    const full = resolveCanvasLims(payload, { xLim: [-1, 3], xScale: "reciprocal", yScale: "linear" });
    expect(full.x.range?.[1]).toBe(3);
    expect(positive(full.x.range)).toBe(true);
    expect(full.x.dropped).toBe(true);
  });

  it("a positive reciprocal pair passes through by reference", () => {
    const fixed: [number, number] = [5, 50];
    const r = resolveCanvasLims(payload, { yLim: fixed, xScale: "linear", yScale: "reciprocal" });
    expect(r.y.range).toBe(fixed);
    expect(r.y.dropped).toBe(false);
  });

  it("a linear axis keeps a typed zero, and a positive log pair passes through by reference", () => {
    expect(resolveCanvasLims(payload, { yLim: [0, null], xScale: "linear", yScale: "linear" }).y.range?.[0]).toBe(0);
    const fixed: [number, number] = [5, 50];
    expect(resolveCanvasLims(payload, { yLim: fixed, xScale: "linear", yScale: "log" }).y.range).toBe(fixed);
  });
});
