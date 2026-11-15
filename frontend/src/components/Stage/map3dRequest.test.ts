// Static 3-D request (gap-5 lane F): the preview and the export are ONE request
// differing only in `fmt` / `filename`, and a 3-D body carries the 3-D choice
// and none of the 2-D marks.

import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import type { Map3dView } from "../../lib/mapView3d";
import { mapFigureBody, type MapExportView } from "./mapFigureExport";
import { choose3d, view3dOptions } from "./map3dRequest";

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
});
