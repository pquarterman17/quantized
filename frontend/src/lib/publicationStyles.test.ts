import { describe, expect, it } from "vitest";

import { MARKER_SHAPES } from "./markers";
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

  // Found while wiring the P3.3 dash/marker cycle: `marker_shape` was added to
  // the wire type and to `buildExportStyles`, but NOT here — so a saved
  // FigureDocument's exact publication styles came back shape-less and every
  // marker reverted to a circle on re-export. Same parity break the backend
  // `_MARKER` table closed, one layer down.
  it("restores marker_shape (a saved figure's glyphs must survive re-export)", () => {
    const out = sanitizeExportSeriesStyles([{ marker: true, marker_shape: "star" }]);
    expect(out).toEqual([{ marker: true, marker_shape: "star" }]);
  });

  it("drops a non-string marker_shape and omits it when unset", () => {
    expect(sanitizeExportSeriesStyles([{ marker: true, marker_shape: 7 }])?.[0]).toEqual({
      marker: true,
    });
    expect(sanitizeExportSeriesStyles([{ color: "#fff" }])?.[0]).not.toHaveProperty("marker_shape");
  });

  // Value-checked like `line`/`step`, and against the SAME `MARKER_SHAPE_VALUES`
  // set `plotspec2.ts`'s view-style sanitizer uses — a hand-edited or
  // future-client blob must not smuggle an unknown glyph as far as the backend's
  // `_MARKER` table to be silently downgraded to a circle there.
  it("rejects a marker_shape that is not one of the eight real glyphs", () => {
    for (const shape of ["hexagon", "", "Circle", "o"]) {
      expect(sanitizeExportSeriesStyles([{ marker: true, marker_shape: shape }])?.[0]).toEqual({
        marker: true,
      });
    }
    // …and every real one still round-trips.
    for (const shape of MARKER_SHAPES.map((m) => m.value)) {
      expect(sanitizeExportSeriesStyles([{ marker_shape: shape }])?.[0]).toEqual({ marker_shape: shape });
    }
  });
});
