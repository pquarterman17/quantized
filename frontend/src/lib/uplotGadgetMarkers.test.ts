// The on-plot markers of the curve-measurement gadget kinds: what is drawn, where,
// and that a change of the measurement redraws.

import { describe, expect, it, vi } from "vitest";

import type { GadgetMeasure } from "./gadgetMeasure";
import { gadgetMarkersPlugin } from "./uplotGadgetMarkers";

const stamp = { units: { x: "", y: "", yB: "" }, source: { id: "a", computedOn: "f", roi: [0, 4] as [number, number], a: { yKey: 0, xKey: null }, b: null, bSheet: null, rows: null } };
const MEASURE: GadgetMeasure = {
  mode: "levelcrossing", auto: false, ...stamp,
  r: { level: 2, hysteresis: 0, crossings: [{ x: 1, direction: "rising" }, { x: 3, direction: "falling" }], n_points: 5, dropped: 0, merged_duplicates: 0 },
};

function fakePlot() {
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), arc: vi.fn(), setLineDash: vi.fn(), strokeStyle: "", lineWidth: 0,
  };
  const u = {
    ctx, bbox: { left: 0, top: 0, width: 100, height: 50 }, redraw: vi.fn(),
    valToPos: (v: number, scale: string) => (scale === "x" ? v * 10 : 50 - v * 10),
  };
  return { u: u as never, ctx, redraw: u.redraw };
}

describe("gadgetMarkersPlugin", () => {
  it("draws a ring per crossing at its (x, level) and a dashed guide at the level", () => {
    const { u, ctx } = fakePlot();
    const p = gadgetMarkersPlugin("red", { get: () => MEASURE, subscribe: () => () => undefined, place: () => ({ scale: "y" }) });
    (p.hooks!.draw as unknown as (u: never) => void)(u);
    expect(ctx.arc.mock.calls.map((c) => [c[0], c[1]])).toEqual([[10, 30], [30, 30]]);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 30); // the guide spans the plot at y = level
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 30);
  });

  it("draws nothing without a measurement", () => {
    const { u, ctx } = fakePlot();
    const p = gadgetMarkersPlugin("red", { get: () => null, subscribe: () => () => undefined, place: () => ({ scale: "y" }) });
    (p.hooks!.draw as unknown as (u: never) => void)(u);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("redraws when the measurement changes and stops after destroy", () => {
    const { u, redraw } = fakePlot();
    let listener: (() => void) | null = null;
    const off = vi.fn();
    const p = gadgetMarkersPlugin("red", { get: () => MEASURE, subscribe: (cb) => { listener = cb; return off; }, place: () => ({ scale: "y" }) });
    (p.hooks!.ready as unknown as (u: never) => void)(u);
    (listener as unknown as () => void)();
    expect(redraw).toHaveBeenCalledTimes(1);
    (p.hooks!.destroy as unknown as () => void)();
    expect(off).toHaveBeenCalled();
  });
});
