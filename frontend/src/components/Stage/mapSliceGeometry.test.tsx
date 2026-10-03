// Plot audit round 3: a map's committed slices and text labels are on the map
// (MapSliceOverlay) but the vector export dropped them. The export now draws
// what `mapMarks` returns — pinned here to be exactly what the overlay draws:
// same definitions, same data-coordinate ends.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MapAnnotation, MapSliceDef } from "../../lib/mapView";
import type { MapPayload } from "../../lib/mapdataFetch";
import { mapFigureBody, type MapExportView } from "./mapFigureExport";
import MapSliceOverlay from "./MapSliceOverlay";
import { mapMarks } from "./mapSliceGeometry";
import { dataToPx } from "./mapRender";

const W = 600;
const H = 400;
const p: MapPayload = {
  xAxis: [30, 32, 34],
  yAxis: [15, 16, 17],
  zGrid: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
  xLabel: "2Theta", xUnit: "deg", yLabel: "Omega", yUnit: "deg", zLabel: "I", zUnit: "cts",
  zMin: 1, zMax: 9,
};

const s = (id: string, over: Partial<MapSliceDef>): MapSliceDef => ({ id, kind: "h", a: { x: 32, y: 16 }, width: 0, space: "angular", ...over });
const slices: MapSliceDef[] = [
  s("h-in", {}),
  s("h-unheld-out", { a: { x: 99, y: 16.5 } }), // x is only where the cut was taken
  s("h-out", { a: { x: 32, y: 40 } }),
  s("v-in", { kind: "v", a: { x: 33, y: 0 } }),
  s("seg-in", { kind: "seg", a: { x: 30.5, y: 15.5 }, b: { x: 33.5, y: 16.5 } }),
  s("seg-out", { kind: "seg", a: { x: 30.5, y: 15.5 }, b: { x: 40, y: 16.5 } }),
  s("other-space", { space: "q" }),
];
const annotations: MapAnnotation[] = [
  { id: "a-in", x: 31, y: 16, text: "film", space: "angular" },
  { id: "a-out", x: 50, y: 16, text: "gone", space: "angular" },
  { id: "a-q", x: 31, y: 16, text: "q", space: "q" },
];

describe("the map's export marks", () => {
  it("are exactly the slices and labels the overlay draws, at the same points", () => {
    render(
      <MapSliceOverlay payload={p} w={W} h={H} slices={slices} annotations={annotations} space="angular" onRemoveSlice={() => {}} onRemoveAnnotation={() => {}} />,
    );
    const drawn = screen.getAllByTestId("map-slice-line");
    const marks = mapMarks(p, slices, annotations, "angular");
    expect(marks.lines).toHaveLength(drawn.length);
    marks.lines.forEach(([x0, y0, x1, y1], i) => {
      const a = dataToPx(p, W, H, x0, y0)!;
      const b = dataToPx(p, W, H, x1, y1)!;
      expect([a[0], a[1], b[0], b[1]]).toEqual(["x1", "y1", "x2", "y2"].map((k) => Number(drawn[i].getAttribute(k))));
    });
    expect(marks.labels.map((l) => l.text)).toEqual(screen.getAllByTestId("map-annotation").map((e) => e.textContent?.replace(/\s*✕$/, "")));
  });

  it("ride the export request only when there are any", () => {
    const view: MapExportView = { cmap: "viridis", logZ: false, colorLimits: null, contour: { on: false, levelCount: 8, scale: "linear" } };
    const opts = { fmt: "svg", style: "default", title: "", filename: "m" };
    const body = mapFigureBody(p, { ...view, marks: { slices, annotations, space: "angular" } }, opts);
    expect(body.lines).toEqual(mapMarks(p, slices, annotations, "angular").lines);
    expect(body.labels).toEqual([{ x: 31, y: 16, text: "film" }]);
    const plain = mapFigureBody(p, { ...view, marks: { slices: [], annotations: [], space: "angular" } }, opts);
    expect(plain).not.toHaveProperty("lines");
    expect(plain).not.toHaveProperty("labels");
  });
});
