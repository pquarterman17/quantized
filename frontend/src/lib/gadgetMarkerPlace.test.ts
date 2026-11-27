// Gadget measurement markers go on the scale of the curve they were measured on
// (Y2 included), through the real plot options, and are hidden (never drawn on
// the wrong scale) where a view moves or turns the curve.

import type uPlot from "uplot";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import { loadGadgetPlugins } from "./axisExtrasHook";
import { measureWhy, placeCurve } from "./gadgetMarkerPlace";
import type { GadgetMeasure } from "./gadgetMeasure";
import type { PlotPayload } from "./plotdata";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";

const ds: Dataset = {
  id: "a", name: "A",
  data: { time: [0, 1, 2, 3], values: [[0, 0], [1, 100], [2, 200], [3, 300]], labels: ["V", "T"], units: ["V", "K"], metadata: {} },
};
// Channel 0 on Y1 (0..3) and channel 1 on Y2 (0..300): the same drawn height means very different values.
const payload: PlotPayload = {
  data: [[0, 1, 2, 3], [0, 1, 2, 3], [0, 100, 200, 300]],
  series: [{ label: "V", unit: "V", axis: 0 }, { label: "T", unit: "K", axis: 1 }],
  xLabel: "t", xUnit: "s",
};
const stamp = (yKey: number) => ({ units: { x: "s", y: "", yB: "" }, source: { id: "a", computedOn: "f", roi: [0, 3] as [number, number], a: { yKey, xKey: null }, b: null, bSheet: null, rows: null } });
const level = (yKey: number, y: number): GadgetMeasure => ({
  mode: "levelcrossing", auto: false, ...stamp(yKey),
  r: { level: y, hysteresis: 0, crossings: [{ x: 1.5, direction: "rising" }], n_points: 4, dropped: 0, merged_duplicates: 0 },
});

beforeAll(loadGadgetPlugins);
beforeEach(() => {
  useApp.setState({
    datasets: [ds], activeId: "a", xKey: null, yKeys: [0, 1], y2Keys: [1], seriesOrder: null, hiddenChannels: [],
    exchangeXY: false, seriesStyles: {}, waterfall: 0, waterfallDx: 0, gadgetMeasure: null,
  });
});

/** The draw hook of the REAL options' marker plugin, over a fake canvas that maps each scale differently. */
function drawn(measure: GadgetMeasure, tweak?: (opts: uPlot.Options) => void) {
  useApp.setState({ gadgetMeasure: measure });
  const opts = buildOpts(payload, { width: 600, height: 400, xScale: "linear", yScale: "linear", onReadout: vi.fn(), tool: "qfit", gadgetMode: "levelcrossing", y2Keys: [1] } as never);
  tweak?.(opts);
  const calls: { v: number; scale: string }[] = [];
  const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), setLineDash: vi.fn() };
  const u = {
    ctx, bbox: { left: 0, top: 0, width: 100, height: 100 }, redraw: vi.fn(),
    series: opts.series, scales: opts.scales,
    // Y1 spans 0..10, Y2 0..1000: 10 px per Y1 unit, 0.1 px per Y2 unit.
    valToPos: (v: number, scale: string) => { calls.push({ v, scale }); return scale === "x" ? v * 10 : scale === "y2" ? 100 - v / 10 : 100 - v * 10; },
  };
  const plugin = opts.plugins!.at(-1)!;
  (plugin.hooks.draw as unknown as (u: unknown) => void)(u);
  return { ctx, calls, opts };
}

describe("gadget markers on a second Y axis", () => {
  it("the real options give the Y2 curve the y2 scale", () => {
    const { opts } = drawn(level(1, 150));
    expect(opts.series.map((s) => s.scale)).toEqual([undefined, "y", "y2"]);
  });

  it("draws a Y2 curve's ring and level guide against y2, not y", () => {
    const { ctx, calls } = drawn(level(1, 150));
    expect(calls.filter((c) => c.scale !== "x").every((c) => c.scale === "y2")).toBe(true);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 85); // the level 150 K at y2: 100 - 15
    expect(ctx.arc.mock.calls.map((c) => [c[0], c[1]])).toEqual([[15, 85]]); // (x 1.5, T 150), never at 100 - 1500
  });

  it("draws a Y1 curve's markers against y, on the same plot", () => {
    const { ctx, calls } = drawn(level(0, 1.5));
    expect(calls.filter((c) => c.scale !== "x").every((c) => c.scale === "y")).toBe(true);
    expect(ctx.arc.mock.calls.map((c) => [c[0], c[1]])).toEqual([[15, 85]]);
  });

  it("puts each interpolated point on its own curve's scale", () => {
    const m: GadgetMeasure = { mode: "interpolate", at: [1, 2], rows: [{ yKey: 0, y: [1, 2] }, { yKey: 1, y: [100, 200] }] };
    const { ctx } = drawn(m);
    expect(ctx.arc.mock.calls.map((c) => [c[0], c[1]])).toEqual([[10, 90], [20, 80], [10, 90], [20, 80]]); // V at 10 px/unit, T at 0.1 px/unit
  });

  it("hides a marker whose axis is not in the plot", () => {
    const { ctx } = drawn(level(1, 150), (o) => { delete (o.scales as Record<string, unknown>).y2; });
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });
});

describe("gadget markers on views that move or turn the curve", () => {
  it("a turned plot (exchanged axes) hides every marker and says why", () => {
    useApp.setState({ exchangeXY: true });
    const { ctx } = drawn(level(0, 1.5));
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(measureWhy(useApp.getState(), level(0, 1.5))).toMatch(/turned/);
  });

  it("horizontal bars turn the plot too", () => {
    useApp.setState({ seriesStyles: { 0: { bars: "horizontal" } as never } });
    expect(measureWhy(useApp.getState(), level(0, 1.5))).toMatch(/turned/);
  });

  it("a waterfall hides the lifted curves' markers but not the first curve's", () => {
    useApp.setState({ waterfall: 0.5 });
    expect(measureWhy(useApp.getState(), level(0, 1.5))).toBeNull(); // the first curve is not lifted
    expect(drawn(level(0, 1.5)).ctx.arc).toHaveBeenCalledTimes(1);
    expect(measureWhy(useApp.getState(), level(1, 150))).toMatch(/waterfall/);
    expect(drawn(level(1, 150)).ctx.arc).not.toHaveBeenCalled();
  });

  it("a waterfall X step shifts every curve of a multi-curve plot", () => {
    useApp.setState({ waterfallDx: 0.1 });
    expect(measureWhy(useApp.getState(), level(0, 1.5))).toMatch(/along X/);
  });

  it("a curve that is not plotted has no place", () => {
    useApp.setState({ yKeys: [0] });
    expect(measureWhy(useApp.getState(), level(1, 150))).toMatch(/not plotted/);
    expect(placeCurve({ series: [{}, { scale: "y" }], scales: { y: {} } } as unknown as uPlot, useApp.getState(), 1)).toEqual({ why: "that curve is not plotted" });
  });

  it("an ordinary view hides nothing", () => {
    expect(measureWhy(useApp.getState(), level(1, 150))).toBeNull();
  });
});
