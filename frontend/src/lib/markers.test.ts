import { describe, expect, it } from "vitest";

import { FILLED_SHAPES, markerDecision, markerPaths, markerSubpaths, MARKER_SHAPES } from "./markers";
import type { DefaultTrace } from "./types";

describe("markerSubpaths", () => {
  it("square is one closed 4-point polygon around the centre", () => {
    const sub = markerSubpaths("square", 10, 20, 4);
    expect(sub).toHaveLength(1);
    expect(sub[0]).toEqual([
      [6, 16],
      [14, 16],
      [14, 24],
      [6, 24],
    ]);
  });

  it("diamond has its vertices on the axes", () => {
    expect(markerSubpaths("diamond", 0, 0, 5)).toEqual([
      [[0, -5], [5, 0], [0, 5], [-5, 0]],
    ]);
  });

  it("plus and cross are two open segments", () => {
    expect(markerSubpaths("plus", 0, 0, 2)).toHaveLength(2);
    expect(markerSubpaths("cross", 0, 0, 2)).toHaveLength(2);
    expect(markerSubpaths("star", 0, 0, 2)).toHaveLength(4); // asterisk = 4 lines
  });

  it("circle yields no subpaths (uPlot draws it)", () => {
    expect(markerSubpaths("circle", 0, 0, 5)).toEqual([]);
  });
});

describe("markerPaths", () => {
  it("returns undefined for circle (use the built-in renderer)", () => {
    expect(markerPaths("circle", 6)).toBeUndefined();
  });
  it("returns a path-builder function for other shapes", () => {
    expect(typeof markerPaths("square", 6)).toBe("function");
  });
});

describe("shape metadata", () => {
  it("every shape has a labelled option", () => {
    const labelled = new Set(MARKER_SHAPES.map((m) => m.value));
    for (const s of ["circle", "square", "triangle", "downtriangle", "diamond", "plus", "cross", "star"]) {
      expect(labelled.has(s as never)).toBe(true);
    }
  });
  it("only the closed glyphs are marked filled", () => {
    expect([...FILLED_SHAPES].sort()).toEqual(["diamond", "downtriangle", "square", "triangle"]);
  });
});

// The ONE marker rule three renderers share: the canvas (`seriesPoints`), the
// legend swatch (`Stage/LegendSample.tsx`) and — by construction — the
// publication export (`exportStyles.buildExportStyles`, which emits a marker
// only for an explicit `style.marker`). The legend used to restate it and drifted:
// with P3.3's cycle on and an ambient Scatter / Line + markers trace it drew
// circle/square/triangle from `style.markerShape` while the canvas drew three
// plain 5px circles and the PDF drew none.
describe("markerDecision — the shared marker rule", () => {
  const traces: DefaultTrace[] = ["Line", "Line + markers", "Scatter", "Step"];

  it("an EXPLICIT marker honours markerShape/markerSize, whatever the trace", () => {
    for (const trace of traces) {
      expect(markerDecision({ marker: true, markerShape: "star", markerSize: 11 }, trace)).toEqual({
        show: true,
        shape: "star",
        size: 11,
      });
      // Defaults when only `marker` is set.
      expect(markerDecision({ marker: true }, trace)).toEqual({ show: true, shape: "circle", size: 5 });
    }
  });

  it("the AMBIENT Scatter / Line + markers trace is a plain 5px circle and reads neither field", () => {
    // This is the export-parity line: `buildExportStyles` emits no marker at all
    // for a series without `style.marker`, so a shape or size taken from here
    // would be drawn on screen and dropped from the PDF.
    for (const trace of ["Scatter", "Line + markers"] as DefaultTrace[]) {
      expect(markerDecision(undefined, trace)).toEqual({ show: true, shape: "circle", size: 5 });
      expect(markerDecision({ markerShape: "star", markerSize: 11 }, trace)).toEqual({
        show: true,
        shape: "circle",
        size: 5,
      });
      // `marker: false` with a stored shape/size — reachable from SeriesStyleCard
      // when "Markers" is unticked.
      expect(markerDecision({ marker: false, markerShape: "diamond", markerSize: 9 }, trace)).toEqual({
        show: true,
        shape: "circle",
        size: 5,
      });
    }
  });

  it("Line and Step draw no markers without an explicit one", () => {
    for (const trace of ["Line", "Step"] as DefaultTrace[]) {
      expect(markerDecision(undefined, trace).show).toBe(false);
      expect(markerDecision({ markerShape: "star" }, trace).show).toBe(false);
    }
  });
});
