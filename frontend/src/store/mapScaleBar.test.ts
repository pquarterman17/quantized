// The map scale bar through the real store and the export request: one undo step
// per change, none for a no-op, and the wire carries the bar with the axis unit.
import { afterEach, describe, expect, it } from "vitest";

import { mapFigureBody, type MapExportView } from "../components/Stage/mapFigureExport";
import type { MapPayload } from "../lib/mapdataFetch";
import { mapViewFor } from "../lib/mapView";
import { setMapScaleBar } from "./mapScaleBarEdit";
import { useApp } from "./useApp";

const ORIGINAL = useApp.getState();
afterEach(() => useApp.setState(ORIGINAL, true));

const view = (id: string) => mapViewFor(useApp.getState().mapViews, id);

describe("setMapScaleBar", () => {
  it("is one undo step per change, nothing for a no-op, and undo restores the previous bar", () => {
    const id = "ds-1";
    const base = { corner: "br", color: "#ffffff" } as const;
    setMapScaleBar(id, base);
    setMapScaleBar(id, { ...base }); // unchanged: no step
    expect(view(id).scaleBar).toEqual(base);
    setMapScaleBar(id, { ...base, corner: "tl", length: 5 });
    expect(view(id).scaleBar).toEqual({ corner: "tl", color: "#ffffff", length: 5 });
    useApp.getState().undo();
    expect(view(id).scaleBar).toEqual(base);
    useApp.getState().undo();
    expect(view(id).scaleBar).toBeUndefined();
  });

  it("removing the bar leaves the map view at its default, so a save carries nothing", () => {
    setMapScaleBar("ds-2", { corner: "br", color: "#ffffff" });
    setMapScaleBar("ds-2", undefined);
    expect(view("ds-2").scaleBar).toBeUndefined();
  });

  it("does nothing without a dataset", () => {
    setMapScaleBar(null, { corner: "br", color: "#ffffff" });
    expect(useApp.getState().mapViews).toBe(ORIGINAL.mapViews);
  });
});

describe("map export request", () => {
  const payload = {
    xAxis: [0, 50, 100], yAxis: [0, 5, 10], zGrid: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    xLabel: "x", xUnit: "nm", yLabel: "y", yUnit: "nm", zLabel: "z", zUnit: "", zMin: 1, zMax: 9,
  } as MapPayload;
  const base: MapExportView = { cmap: "viridis", logZ: false, colorLimits: null, contour: { on: false, levelCount: 8, scale: "linear" } };
  const opts = { fmt: "pdf", style: "default", title: "", filename: "m" };

  it("carries the bar with the X axis unit for its automatic label", () => {
    const b = mapFigureBody(payload, { ...base, scaleBar: { corner: "tl", color: "#00ff00", length: 20 } }, opts);
    expect(b.scale_bar).toEqual({ corner: "tl", color: "#00ff00", length: 20, unit: "nm" });
  });
  it("sends no bar unless one is set, and none on a 3-D view", () => {
    expect(mapFigureBody(payload, base, opts)).not.toHaveProperty("scale_bar");
    const v3 = { kind: "surface", elev: 30, azim: -60, zoom: 1 } as never;
    expect(mapFigureBody(payload, { ...base, view3d: v3, scaleBar: { corner: "br", color: "#ffffff" } }, opts)).not.toHaveProperty("scale_bar");
  });
});
