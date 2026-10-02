// The canvas' scanned X range against a REAL uPlot instance. uPlot calls the
// x scale's range function on EVERY x `setScale` — a box/wheel zoom and a pan
// included, not only on autoscale (uPlot.esm.js's commit: `wsc.range(self,
// wsc.min, wsc.max, k)` for the x series, unconditionally) — so a range
// function that ignored its bounds snapped every zoom straight back to the
// full extent. Pinned for both scanned-range users (a hysteresis loop and a
// waterfall X-offset layout), with a plain monotonic plot as the unchanged
// control. jsdom lacks `matchMedia` and `Path2D`, which uPlot reads at import
// and draw time; minimal stubs are installed before the import.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as { Path2D?: unknown };
  g.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
    closePath() {}
    addPath() {}
    bezierCurveTo() {}
  };
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

import uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";
import { fullXExtents } from "./uplotXRange";

const LOOP: PlotPayload = {
  // Starts and ends at the SAME field: uPlot's own autoscale passes a padded
  // interval around it rather than [first, last].
  data: [[-100, 0, 100, 0, -100], [-1, -0.5, 1, 0.5, -1]] as PlotPayload["data"],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};
const OPEN_LOOP: PlotPayload = { ...LOOP, data: [[-100, 0, 100, 0, -90], [-1, -0.5, 1, 0.5, -0.9]] as PlotPayload["data"] };
// A VSM loop that starts at +Hmax and returns just short of it: the first x is
// ABOVE the last, so uPlot's setScale swaps them and the autoscale call arrives
// as [last, first], not [first, last].
const DESCENDING_LOOP: PlotPayload = { ...LOOP, data: [[100, 0, -100, 0, 90], [1, 0.5, -1, -0.5, 0.9]] as PlotPayload["data"] };
// A waterfall X-offset layout (lib/waterfallX.ts): two blocks of three rows.
const WATERFALL: PlotPayload = {
  data: [[0, 1, 2, 5, 6, 7], [1, 2, 3, null, null, null], [null, null, null, 4, 5, 6]] as PlotPayload["data"],
  series: [{ label: "A", unit: "" }, { label: "B", unit: "" }],
  xLabel: "x",
  xUnit: "",
  blockRows: 3,
};
const MONOTONIC: PlotPayload = { ...LOOP, data: [[0, 1, 2, 3], [1, 2, 3, 4]] as PlotPayload["data"] };

const live: uPlot[] = [];
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

const settle = () => new Promise((r) => setTimeout(r, 0)); // uPlot commits on a microtask
const xOf = (u: uPlot) => [u.scales.x.min, u.scales.x.max];

async function mount(payload: PlotPayload, xLim?: [number, number]) {
  const opts = buildOpts(payload, { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), xLim });
  const u = new uPlot(opts, payload.data, document.body.appendChild(document.createElement("div")));
  live.push(u);
  await settle();
  return u;
}

describe("the scanned X range keeps an explicit zoom (real uPlot)", () => {
  it.each([
    ["a closed hysteresis loop", LOOP],
    ["an open hysteresis loop", OPEN_LOOP],
    ["a loop whose first x is above its last", DESCENDING_LOOP],
    ["a waterfall X-offset layout", WATERFALL],
  ])("%s: autoscales to the scan, keeps a zoom and a pan, resets to the scan", async (_, payload) => {
    const u = await mount(payload);
    const scan = fullXExtents(payload, undefined, false)!;
    expect(xOf(u)).toEqual(scan);

    u.setScale("x", { min: 0.5, max: 1.5 }); // a box/wheel zoom
    await settle();
    expect(xOf(u)).toEqual([0.5, 1.5]);
    u.setScale("x", { min: 1, max: 2 }); // a pan
    await settle();
    expect(xOf(u)).toEqual([1, 2]);

    u.setData(payload.data); // what a double-click reset does: uPlot's own autoscale
    await settle();
    expect(xOf(u)).toEqual(scan);
  });

  it("control: a monotonic plot has no range function and zooms as uPlot always did", async () => {
    const u = await mount(MONOTONIC);
    expect(xOf(u)).toEqual([0, 3]);
    u.setScale("x", { min: 0.5, max: 1.5 });
    await settle();
    expect(xOf(u)).toEqual([0.5, 1.5]);
  });
});

// A FIXED X limit (`xLim`: a committed zoom, an Inspector value, a restored
// view) is what the plot is BUILT with after any rebuild while zoomed — a
// windowed re-fetch, a theme change. A static `range` pair is answered on every
// x setScale too, so it pinned the live plot: the next zoom/pan, and the
// Inspector applying a new limit to the live instance, snapped back to it.
describe("a fixed X limit applies on autoscale only (real uPlot)", () => {
  it.each([
    ["a monotonic plot", MONOTONIC],
    ["a closed hysteresis loop", LOOP],
    ["a loop whose first x is above its last", DESCENDING_LOOP],
    ["a waterfall X-offset layout", WATERFALL],
  ])("%s: starts at the limit, keeps a zoom, a pan and a new limit, resets to the limit", async (_, payload) => {
    const lim: [number, number] = [-0.5, 2.5];
    const u = await mount(payload, lim);
    expect(xOf(u)).toEqual(lim);

    u.setScale("x", { min: 0.5, max: 1.5 }); // a box/wheel zoom
    await settle();
    expect(xOf(u)).toEqual([0.5, 1.5]);
    u.setScale("x", { min: 1, max: 2 }); // a pan
    await settle();
    expect(xOf(u)).toEqual([1, 2]);
    u.setScale("x", { min: 0, max: 2 }); // the Inspector's live apply (PlotViewport, classifyLimChange "apply")
    await settle();
    expect(xOf(u)).toEqual([0, 2]);

    u.setData(payload.data); // uPlot's own autoscale (a double-click reset)
    await settle();
    expect(xOf(u)).toEqual(lim);
  });
});
