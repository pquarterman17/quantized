import { describe, expect, it } from "vitest";

import { sanitizeExportSeriesStyles } from "./publicationStyles";

describe("sanitizeExportSeriesStyles", () => {
  it("passes through a well-formed entry, including line/marker/fill/color_by", () => {
    const out = sanitizeExportSeriesStyles([
      { color: "#ff0000", width: 2, line: "dashed", marker: true, marker_size: 6, fill: "under", color_by: 2, colormap: "magma" },
    ]);
    expect(out).toEqual([
      { color: "#ff0000", width: 2, line: "dashed", marker: true, marker_size: 6, fill: "under", color_by: 2, colormap: "magma" },
    ]);
  });

  it("returns null for a non-array / null input", () => {
    expect(sanitizeExportSeriesStyles(null)).toBeNull();
    expect(sanitizeExportSeriesStyles("nope")).toBeNull();
    expect(sanitizeExportSeriesStyles(undefined)).toBeNull();
  });

  it("drops a null entry to null, and an entry with no valid fields to null", () => {
    const out = sanitizeExportSeriesStyles([null, { bogus: "field" }]);
    expect(out).toEqual([null, null]);
  });

  // ── GAP_PLOTTYPES: Graph Builder "step" mark export parity ──────────────
  it("captures a valid step value", () => {
    for (const step of ["pre", "post", "mid"] as const) {
      expect(sanitizeExportSeriesStyles([{ step }])).toEqual([{ step }]);
    }
  });

  it("drops an unrecognized step value without nulling the rest of the entry", () => {
    const out = sanitizeExportSeriesStyles([{ color: "#fff", step: "diagonal" }]);
    expect(out).toEqual([{ color: "#fff" }]);
  });

  it("omits step when unset", () => {
    const out = sanitizeExportSeriesStyles([{ color: "#fff" }]);
    expect(out?.[0]).not.toHaveProperty("step");
  });
});
