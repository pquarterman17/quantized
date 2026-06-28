import { describe, expect, it } from "vitest";

import { FILLED_SHAPES, markerPaths, markerSubpaths, MARKER_SHAPES } from "./markers";

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
