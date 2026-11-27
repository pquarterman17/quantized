import { describe, expect, it } from "vitest";

import { defaultPlotView, sanitizePlotView } from "./plotview";
import { overlaysOn, overlaysWire, overlayViewRefusal, sanitizePlotOverlays } from "./plotOverlays";
import { viewOverrides } from "./figureViewOverrides";

const ALL = { line: { band: "confidence", level: 0.9 }, smoother: { span: 0.4 }, ellipse: { level: 0.68 } };

describe("plot overlays model", () => {
  it("are off by default", () => {
    expect(defaultPlotView().overlays).toBeNull();
    expect(overlaysWire(null)).toBeUndefined();
    expect(viewOverrides(defaultPlotView(), [])?.overlays).toBeUndefined();
  });

  it("sanitize keeps valid values and drops malformed ones", () => {
    expect(sanitizePlotOverlays(ALL)).toEqual(ALL);
    expect(sanitizePlotOverlays({ line: { band: "wide", level: 7 }, smoother: { span: 9 } })).toEqual({
      line: { band: "none", level: 0.95 },
      smoother: { span: 0.5 },
      ellipse: null,
    });
    for (const bad of [null, undefined, 3, "x", [], {}, { line: 1, ellipse: false }]) expect(sanitizePlotOverlays(bad)).toBeNull();
    expect(overlaysOn({ line: null, smoother: null, ellipse: null })).toBe(false);
  });

  it("the wire carries only the overlays that are on", () => {
    expect(overlaysWire({ line: null, smoother: { span: 0.3 }, ellipse: null })).toEqual({ smoother: { span: 0.3 } });
    expect(overlaysWire(sanitizePlotOverlays(ALL))).toEqual(ALL);
  });

  it("group shapes (item 24): centroid, hull and the mean ellipse are opt-in and survive sanitize and the wire", () => {
    const g = { line: null, smoother: null, ellipse: { level: 0.9, kind: "mean" as const }, centroid: true, hull: true };
    expect(sanitizePlotOverlays(g)).toEqual(g);
    expect(overlaysWire(sanitizePlotOverlays(g))).toEqual({ ellipse: { level: 0.9, kind: "mean" }, centroid: true, hull: true });
    expect(overlaysOn({ line: null, smoother: null, ellipse: null, hull: true })).toBe(true);
    // The data ellipse is the default and adds no key to the wire; unknown kinds and non-true flags are dropped.
    expect(overlaysWire({ line: null, smoother: null, ellipse: { level: 0.95, kind: "data" } })).toEqual({ ellipse: { level: 0.95 } });
    expect(sanitizePlotOverlays({ ellipse: { level: 0.95, kind: "wide" }, hull: "yes", centroid: 1 })).toEqual({ line: null, smoother: null, ellipse: { level: 0.95 } });
    expect(sanitizePlotView({ ...defaultPlotView(), overlays: g }).overlays).toEqual(g);
    expect(viewOverrides({ ...defaultPlotView(), overlays: sanitizePlotOverlays(g) }, [])?.overlays).toEqual(overlaysWire(g));
  });

  it("a saved plot view round-trips the overlays and an old one has none", () => {
    expect(sanitizePlotView({ ...defaultPlotView(), overlays: ALL }).overlays).toEqual(ALL);
    const old: Record<string, unknown> = { ...defaultPlotView() };
    delete old.overlays;
    expect(sanitizePlotView(old).overlays).toBeNull();
  });

  it("refuse a log axis, exchanged axes and a waterfall", () => {
    const ok = { xScale: "linear", yScale: "linear", exchangeXY: false, waterfall: 0, waterfallDx: 0 };
    expect(overlayViewRefusal(ok)).toBeNull();
    expect(overlayViewRefusal({ ...ok, yScale: "log" })).toMatch(/linear/);
    expect(overlayViewRefusal({ ...ok, exchangeXY: true })).toMatch(/exchanged/);
    expect(overlayViewRefusal({ ...ok, waterfall: 0.2 })).toMatch(/waterfall/);
    expect(overlayViewRefusal({ ...ok, horizontalBars: true })).toMatch(/horizontal bars/);
  });

  it("the export carries them only where the canvas draws them", () => {
    const v = { ...defaultPlotView(), overlays: sanitizePlotOverlays(ALL) };
    expect(viewOverrides(v, [])?.overlays).toEqual(ALL);
    expect(viewOverrides({ ...v, xScale: "log" }, [])?.overlays).toBeUndefined();
    expect(viewOverrides({ ...v, exchangeXY: true }, [])?.overlays).toBeUndefined();
    expect(viewOverrides({ ...v, waterfall: 0.1 }, [])?.overlays).toBeUndefined();
    // Horizontal bars turn the layer: the canvas refuses, and the backend would 422.
    expect(viewOverrides({ ...v, seriesStyles: { 0: { bars: "horizontal" } } }, [])?.overlays).toBeUndefined();
    expect(viewOverrides({ ...v, seriesStyles: { 0: { bars: true } } }, [])?.overlays).toEqual(ALL);
  });
});
