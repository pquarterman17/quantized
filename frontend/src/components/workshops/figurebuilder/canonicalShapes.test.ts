import { describe, expect, it } from "vitest";

import type { Shape } from "../../../lib/types";
import {
  deriveShapeRows,
  patchShapeList,
  removeShapeFromList,
  shapeIdForHit,
  shapeSupportsFill,
  translateShape,
} from "./canonicalShapes";

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

describe("shapeIdForHit", () => {
  it("maps a hit index straight through when every shape is finite", () => {
    const shapes = [shape("s1", "arrow"), shape("s2", "rect"), shape("s3", "line")];
    expect([0, 1, 2].map((n) => shapeIdForHit(shapes, n))).toEqual(["s1", "s2", "s3"]);
  });

  it("skips a non-finite shape, exactly as the render request does", () => {
    // figureSpec's viewOverrides drops it, so element `shape:1` is the THIRD
    // draft shape -- indexing the draft directly would drag the wrong one.
    const bad: Shape = { id: "bad", kind: "rect", x1: 0, y1: 0, x2: Number.NaN, y2: 1 };
    const shapes = [shape("s1", "arrow"), bad, shape("s3", "line")];
    expect(shapeIdForHit(shapes, 0)).toBe("s1");
    expect(shapeIdForHit(shapes, 1)).toBe("s3");
  });

  it("returns null past the end rather than undefined-ing a caller", () => {
    expect(shapeIdForHit([shape("s1", "arrow")], 5)).toBeNull();
    expect(shapeIdForHit([], 0)).toBeNull();
  });

  it("rejects a malformed index instead of coercing it", () => {
    const shapes = [shape("s1", "arrow")];
    expect(shapeIdForHit(shapes, -1)).toBeNull();
    expect(shapeIdForHit(shapes, 1.5)).toBeNull();
    expect(shapeIdForHit(shapes, Number.NaN)).toBeNull();
  });
});

describe("translateShape", () => {
  it("adds (dx, dy) to every coordinate", () => {
    const s: Shape = { id: "s1", kind: "rect", x1: 2, y1: 3, x2: 4, y2: 5, stroke: "--series-2" };
    expect(translateShape(s, 1, -1)).toEqual({ x1: 3, y1: 2, x2: 5, y2: 4 });
  });

  it("returns null instead of a broken patch when the result isn't finite", () => {
    const s = shape("s1", "line");
    expect(translateShape(s, Number.NaN, 0)).toBeNull();
    expect(translateShape(s, Number.POSITIVE_INFINITY, 0)).toBeNull();
  });
});
