// Static 3-D request (gap-5 lane F): the preview and the export are ONE request
// differing only in `fmt` / `filename`, and a 3-D body carries the 3-D choice
// and none of the 2-D marks.

import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import type { Map3dView } from "../../lib/mapView3d";
import { mapFigureBody, type MapExportView } from "./mapFigureExport";
import type { DataStruct } from "../../lib/types";
import { choose3d, view3dCaption, view3dOptions, WATERFALL_MAX_LINES } from "./map3dRequest";

const payload = {
  xAxis: [0, 1, 2], yAxis: [0, 1],
  zGrid: [[1, 2, 3], [4, null, 6]],
  zMin: 1, zMax: 6, xLabel: "Qx", yLabel: "Qz", zLabel: "Intensity", xUnit: "A", yUnit: "A", zUnit: "cps",
} as unknown as MapPayload;

const V: Map3dView = { kind: "surface", elev: 40, azim: 25, zLabel: "", zUnit: "", style: "default", title: "My title" };
const view = (v3: Map3dView | undefined): MapExportView => ({
  cmap: "magma", logZ: false, colorLimits: [1, 8], contour: { on: true, levelCount: 8, scale: "linear" }, view3d: v3,
  marks: { slices: [{ id: "s", kind: "h", a: { x: 1, y: 0.5 }, width: 0, space: "angular" }], annotations: [], space: "angular" },
});

describe("static 3-D map request", () => {
  it("preview and export are the same request except fmt and filename", () => {
    for (const kind of ["surface", "scatter3d", "waterfall"] as const) {
      const v3 = { ...V, kind };
      const preview = mapFigureBody(payload, view(v3), view3dOptions(v3, "png", "preview"));
      const exported = mapFigureBody(payload, view(v3), view3dOptions(v3, "pdf", "scan_map"));
      expect({ ...preview, fmt: "x", filename: "x" }).toEqual({ ...exported, fmt: "x", filename: "x" });
      expect(preview.fmt).toBe("png");
      expect(exported.fmt).toBe("pdf");
      expect(exported.kind).toBe(kind);
    }
  });

  it("carries the angles, colormap, limits, title and the z label override; drops 2-D marks", () => {
    const body = mapFigureBody(payload, view({ ...V, zLabel: "Counts", zUnit: "arb" }), view3dOptions(V, "svg", "f"));
    expect(body).toMatchObject({ kind: "surface", view_elev: 40, view_azim: 25, cmap: "magma",title: "My title", z_label: "Counts (arb)", z_limits: [1, 8] });
    expect(body.lines).toBeUndefined();
    expect(body.labels).toBeUndefined();
    expect(body.equal_aspect).toBeUndefined();
    // A blank override falls back to the channel's own.
    expect(mapFigureBody(payload, view(V), view3dOptions(V, "svg", "f")).z_label).toBe("Intensity (cps)");
  });

  it("the 2-D request is unchanged: heatmap/contour kinds, no view angles", () => {
    const body = mapFigureBody(payload, view(undefined), { fmt: "pdf", style: "default", title: "", filename: "f" });
    expect(body.kind).toBe("contourf");
    expect(body.view_elev).toBeUndefined();
  });

  it("a changed angle changes the body (it is the preview's refetch key)", () => {
    const a = JSON.stringify(mapFigureBody(payload, view(V), view3dOptions(V, "png", "p")));
    const v2 = { ...V, azim: 26 };
    expect(JSON.stringify(mapFigureBody(payload, view(v2), view3dOptions(v2, "png", "p")))).not.toBe(a);
  });

  it("the dialog choice: kinds map, 2-D map clears, bad angles are refused with a reason", () => {
    const base = { elev: 20, azim: -30, style: "default", title: "" };
    expect(choose3d(undefined, { ...base, view: "3-D scatter" })).toEqual({ ok: true, view3d: expect.objectContaining({ kind: "scatter3d", elev: 20, azim: -30 }) });
    expect(choose3d(V, { ...base, view: "2-D map" })).toEqual({ ok: true, view3d: undefined });
    expect(choose3d(undefined, { ...base, view: "Surface", elev: 95 })).toMatchObject({ ok: false });
    expect(choose3d(undefined, { ...base, view: "Surface", azim: NaN })).toMatchObject({ ok: false });
    // The panel's z label survives a dialog round-trip.
    expect(choose3d({ ...V, zLabel: "keep" }, { ...base, view: "Surface" })).toMatchObject({ view3d: { zLabel: "keep" } });
  });

  // ── scatter of RAW points, stepped waterfall rows (gap-5 lane F) ──
  const data: DataStruct = {
    time: [0, 1, 2, 3],
    values: [[5, 7, 10], [6, 8, -2], [Number.NaN, 9, 12], [3.5, 2.5, 4]],
    labels: ["x", "y", "z"], units: ["", "", ""], metadata: {},
  };
  const SC: Map3dView = { ...V, kind: "scatter3d" };
  const scattered = { ...payload, interpolated: { nPoints: 4 } } as MapPayload;

  it("a 3-D scatter of scattered data plots the ORIGINAL points, not the regridded surface", () => {
    const v = { ...view(SC), colorLimits: null, source: { data, keys: [0, 1, 2] as const } };
    const preview = mapFigureBody(scattered, v, view3dOptions(SC, "png", "p"));
    const exported = mapFigureBody(scattered, v, view3dOptions(SC, "pdf", "f"));
    for (const b of [preview, exported]) {
      expect(b.contour_source).toBe("points");
      expect(b.z_grid).toBeUndefined();
      // the NaN row is dropped whole; every other point is sent unchanged
      expect(b.x_axis).toEqual([5, 6, 3.5]);
      expect(b.y_axis).toEqual([7, 8, 2.5]);
      expect(b.z_values).toEqual([10, -2, 4]);
      expect(b.note).toBeUndefined(); // nothing was interpolated
    }
    expect({ ...preview, fmt: "", filename: "" }).toEqual({ ...exported, fmt: "", filename: "" });
    expect(view3dCaption(scattered, v)).toMatch(/4 original points/);
  });

  it("log scale drops non-positive raw points whole; limits still clamp", () => {
    const v = { ...view(SC), logZ: true, colorLimits: [null, 8] as [null, number], source: { data, keys: [0, 1, 2] as const } };
    const b = mapFigureBody(scattered, v, view3dOptions(SC, "png", "p"));
    expect(b.z_values).toEqual([Math.log10(8), Math.log10(4)]);
    expect(b.x_axis).toEqual([5, 3.5]);
  });

  it("genuinely gridded data keeps the grid path for a scatter", () => {
    const v = { ...view(SC), source: { data, keys: [0, 1, 2] as const } };
    const b = mapFigureBody(payload, v, view3dOptions(SC, "png", "p"));
    expect(b.z_grid).toBeDefined();
    expect(b.contour_source).toBeUndefined();
  });

  it("a grid waterfall is capped to a readable line count, and the caption says how many", () => {
    const rows = 200;
    const big = { ...payload, yAxis: Array.from({ length: rows }, (_, i) => i), zGrid: Array.from({ length: rows }, () => [1, 2, 3]) } as unknown as MapPayload;
    const W: Map3dView = { ...V, kind: "waterfall" };
    const b = mapFigureBody(big, view(W), view3dOptions(W, "png", "p"));
    expect(b.max_lines).toBe(WATERFALL_MAX_LINES);
    expect(view3dCaption(big, view(W))).toBe(`Drawing ${WATERFALL_MAX_LINES} of 200 grid rows (evenly stepped).`);
    expect(mapFigureBody(payload, view(V), view3dOptions(V, "png", "p")).max_lines).toBeUndefined();
  });
});
