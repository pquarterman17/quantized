import { describe, expect, it } from "vitest";

import { FILLED_SHAPES, markerDecision, markerPaths, markerRingWidth, markerSubpaths, seriesPoints, seriesTrace } from "./markers";
import { originCurveSeriesStyle } from "./originCurveText";
import { MARKER_SHAPES } from "./markerShapes";
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

  it("an `explicit` style is filled by no trace: no marker unless it sets one", () => {
    for (const trace of traces) {
      expect(seriesTrace({ explicit: true }, trace)).toBe("Line");
      expect(markerDecision({ explicit: true }, trace).show).toBe(false);
      expect(markerDecision({ explicit: true, marker: true }, trace).show).toBe(true);
      // Older saved styles carry no flag and keep the default trace.
      expect(seriesTrace({}, trace)).toBe(trace);
      expect(seriesTrace({ explicit: false }, trace)).toBe(trace);
    }
  });

  it("Line and Step draw no markers without an explicit one", () => {
    for (const trace of ["Line", "Step"] as DefaultTrace[]) {
      expect(markerDecision(undefined, trace).show).toBe(false);
      expect(markerDecision({ markerShape: "star" }, trace).show).toBe(false);
    }
  });
});

// R-39: uPlot draws a circle at radius (size - points.width) / 2 and defaults
// points.width to max(1, (3 + 2*max(1, lineWidth)) * 0.2). An Origin 0.5 pt
// symbol (SOP_meas Graph14 L5) gave radius -0.25 and Path2D.arc threw.
describe("marker ring width never makes uPlot's circle radius negative", () => {
  /** The radius uPlot's built-in circle will use for these points. */
  const uplotRadius = (pts: ReturnType<typeof seriesPoints>, lineWidth: number) => {
    const w = pts.width ?? Math.max(1, (3 + Math.max(1, lineWidth) * 2) * 0.2);
    return ((pts.size as number) - (w as number)) / 2;
  };

  it("an Origin 0.5 pt circle scatter builds a non-negative radius", () => {
    const style = originCurveSeriesStyle({ style: "scatter", symbol: "circle", symbolSize: 0.5, lineWidth: 0.5 })!;
    expect(style.markerSize).toBe(0.5);
    const pts = seriesPoints(style, "Line", "#f00", style.width ?? 0);
    expect(pts.size).toBe(0.5); // the size Origin drew, not enlarged
    expect(pts.width).toBe(0.25);
    expect(uplotRadius(pts, 0)).toBeGreaterThanOrEqual(0);
  });

  it("holds for every small size and line width", () => {
    for (const size of [0, 0.1, 0.5, 1, 1.5, 2, 2.5, 3, 5]) {
      for (const lw of [0, 0.5, 1, 1.5, 3, 5, 8]) {
        const pts = seriesPoints({ marker: true, markerSize: size }, "Line", "#f00", lw);
        expect(uplotRadius(pts, lw)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("leaves an ordinary marker's config untouched (uPlot's default ring)", () => {
    expect(markerRingWidth(5, 1.5)).toBeUndefined();
    expect(seriesPoints({ marker: true }, "Line", "#f00", 1.5)).toEqual({ show: true, size: 5 });
    expect(markerRingWidth(2, 5)).toBe(1); // a thick line's default ring (2.6) would not fit
  });
});
