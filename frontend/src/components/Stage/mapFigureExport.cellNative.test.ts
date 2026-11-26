// The export names the MEASURED cells for its labels, not the display grid.
import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import { mapFigureBody, type MapExportView } from "./mapFigureExport";

const payload = { xAxis: [0, 5, 10], yAxis: [0, 5, 10], zGrid: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "", zMin: 1, zMax: 9 } as MapPayload;
const native = { xAxis: [0, 10], yAxis: [0, 10], values: [[1, null], [3, 4]] };
const view: MapExportView = { cmap: "viridis", logZ: false, colorLimits: null, contour: { on: false, levelCount: 8, scale: "linear" }, cellLabels: { format: "fixed", precision: 1 }, cellNative: native };
const opts = { fmt: "pdf", style: "default", title: "", filename: "m" };

describe("mapFigureBody cell labels", () => {
  it("sends the measured lattice, and no display-grid values, when the data is a lattice", () => {
    const b = mapFigureBody(payload, { ...view, logZ: true }, opts);
    expect(b.cell_labels).toEqual({ format: "fixed", precision: 1, native: { x_axis: [0, 10], y_axis: [0, 10], values: [[1, null], [3, 4]] } });
  });
  it("falls back to the display grid's raw values on a log grid when it is not", () => {
    const b = mapFigureBody(payload, { ...view, cellNative: null, logZ: true }, opts);
    expect(b.cell_labels).toMatchObject({ values: payload.zGrid });
    expect(b.cell_labels).not.toHaveProperty("native");
  });
});
