import { describe, expect, it } from "vitest";

import type { Shape } from "../../../lib/types";
import { deriveShapeRows, patchShapeList, removeShapeFromList, shapeSupportsFill } from "./canonicalShapes";

const shape = (id: string, kind: Shape["kind"]): Shape => ({
  id, kind, x1: 0, y1: 0, x2: 1, y2: 1,
});

describe("deriveShapeRows", () => {
  it("returns an empty list for an empty draft", () => {
    expect(deriveShapeRows([])).toEqual([]);
  });

  it("labels a single shape '<kind> 1'", () => {
    expect(deriveShapeRows([shape("s1", "arrow")])).toEqual([
      { id: "s1", kind: "arrow", label: "arrow 1" },
    ]);
  });

  it("numbers same-kind shapes independently of other kinds, in draft order", () => {
    const shapes = [shape("s1", "arrow"), shape("s2", "rect"), shape("s3", "arrow"), shape("s4", "rect")];
    expect(deriveShapeRows(shapes)).toEqual([
      { id: "s1", kind: "arrow", label: "arrow 1" },
      { id: "s2", kind: "rect", label: "rect 1" },
      { id: "s3", kind: "arrow", label: "arrow 2" },
      { id: "s4", kind: "rect", label: "rect 2" },
    ]);
  });
});

describe("shapeSupportsFill", () => {
  it("rect and ellipse support fill", () => {
    expect(shapeSupportsFill("rect")).toBe(true);
    expect(shapeSupportsFill("ellipse")).toBe(true);
  });
  it("arrow and line do not", () => {
    expect(shapeSupportsFill("arrow")).toBe(false);
    expect(shapeSupportsFill("line")).toBe(false);
  });
});

describe("patchShapeList", () => {
  it("merges a patch into the one shape matching id, leaving siblings untouched", () => {
    const shapes = [shape("s1", "arrow"), shape("s2", "rect")];
    const next = patchShapeList(shapes, "s2", { stroke: "--series-3", width: 2 });
    expect(next).toEqual([
      shape("s1", "arrow"),
      { ...shape("s2", "rect"), stroke: "--series-3", width: 2 },
    ]);
    expect(next[0]).toBe(shapes[0]); // untouched sibling kept by reference
  });

  it("is a no-op (same entries) for an unknown id", () => {
    const shapes = [shape("s1", "arrow")];
    expect(patchShapeList(shapes, "missing", { width: 5 })).toEqual(shapes);
  });
});

describe("removeShapeFromList", () => {
  it("drops the one shape matching id", () => {
    const shapes = [shape("s1", "arrow"), shape("s2", "rect")];
    expect(removeShapeFromList(shapes, "s1")).toEqual([shape("s2", "rect")]);
  });

  it("is a no-op for an unknown id", () => {
    const shapes = [shape("s1", "arrow")];
    expect(removeShapeFromList(shapes, "missing")).toEqual(shapes);
  });
});
