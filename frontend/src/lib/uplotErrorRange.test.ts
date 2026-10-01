// Error bars in the canvas autoscale (`lib/uplotErrorRange.ts`) — the edges
// the shared wire fixture (`xyErrorAutoscaleFixture.test.ts`) does not cover.

import { afterEach, describe, expect, it, vi } from "vitest";

// uPlot reads matchMedia at import and draws through Path2D; jsdom has neither.
vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

import uPlot from "uplot";

import "./uplotPaths"; // provides uPlot's range helpers, as every canvas loads it

import type { ErrorSpan } from "./errorbars";
import type { PlotPayload } from "./plotdata";
import { buildOpts, type BuildOptsArgs } from "./uplotOpts";

const PAYLOAD: PlotPayload = {
  data: [[0, 1, 2, 3], [10, 11, 12, 13], [1, 2, 3, 4]],
  series: [{ label: "A", unit: "" }, { label: "B", unit: "", axis: 1 }],
  xLabel: "x",
  xUnit: "",
};

const BASE: BuildOptsArgs = {
  width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
};

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

async function draw(payload: PlotPayload, args: Partial<BuildOptsArgs>): Promise<uPlot> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(buildOpts(payload, { ...BASE, ...args }), payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0));
  return u;
}

const scale = (u: uPlot, key: string) => [u.scales[key].min, u.scales[key].max];
const ySpan = (plus: (number | null)[], minus = plus): ErrorSpan => ({ axis: "y", plus, minus });

describe("error bars in the canvas autoscale", () => {
  it("leaves a plot without error bars exactly as uPlot ranges it", () => {
    const none = buildOpts(PAYLOAD, BASE).scales;
    expect(buildOpts(PAYLOAD, { ...BASE, errorBars: new Map(), errorSpans: new Map() }).scales).toEqual(none);
    // Bars that cannot be drawn (no magnitude anywhere) change nothing either.
    expect(buildOpts(PAYLOAD, { ...BASE, errorSpans: new Map([[1, [ySpan([null, null, null, null])]]]) }).scales).toEqual(none);
  });

  it("covers the legacy symmetric bars, on their own axis only", async () => {
    const u = await draw(PAYLOAD, { y2Scale: "linear", errorBars: new Map([[2, [0, 10, 0, 0]]]) });
    expect(scale(u, "y")).toEqual(uPlot.rangeNum(10, 13, 0.1, true));
    expect(scale(u, "y2")).toEqual(uPlot.rangeNum(-8, 12, 0.1, true));
  });

  it("covers an asymmetric span's two different ends", async () => {
    const u = await draw(PAYLOAD, { errorSpans: new Map([[1, [ySpan([0, 0, 0, 7], [4, 0, 0, 0])]]]) });
    expect(scale(u, "y")).toEqual(uPlot.rangeNum(6, 20, 0.1, true));
  });

  it("drops a non-positive bar end on a log axis", async () => {
    const u = await draw(PAYLOAD, { yScale: "log", errorSpans: new Map([[1, [ySpan([990, 0, 0, 0], [20, 0, 0, 0])]]]) });
    // The 10-20 end is below zero, so only 10+990 = 1000 widens (data alone: 10..100).
    expect(scale(u, "y")).toEqual([10, 1000]);
  });

  it("widens again on uPlot's own reset after a zoom", async () => {
    const u = await draw(PAYLOAD, { errorSpans: new Map([[1, [{ axis: "x", plus: [0, 0, 0, 2], minus: [1, 0, 0, 0] }]]]) });
    expect(scale(u, "x")).toEqual([-1, 5]);
    u.setScale("x", { min: 1, max: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(scale(u, "x")).toEqual([1, 2]);
    u.setData(u.data); // what uPlot's double-click reset runs
    await new Promise((r) => setTimeout(r, 0));
    expect(scale(u, "x")).toEqual([-1, 5]);
  });

  it("a hidden series' bars stop counting when it is toggled off", async () => {
    const both = { ...PAYLOAD, series: [{ label: "A", unit: "" }, { label: "B", unit: "" }] };
    const u = await draw(both, { errorSpans: new Map([[1, [ySpan([0, 50, 0, 0])]]]) });
    expect(scale(u, "y")).toEqual(uPlot.rangeNum(-39, 61, 0.1, true));
    u.setSeries(1, { show: false });
    u.setData(u.data);
    await new Promise((r) => setTimeout(r, 0));
    expect(scale(u, "y")).toEqual(uPlot.rangeNum(1, 4, 0.1, true));
  });
});
