import { describe, expect, it } from "vitest";

import {
  boundingEllipse,
  distanceToRectEdge,
  ellipseEdgeDistance,
  ellipseParam,
  hitTestShapeBody,
  hitTestShapeHandle,
  pointInRect,
  pointToSegmentDistance,
  shapeHandles,
  shapeReshapeFields,
  type ShapeGeom,
} from "./shapeHit";

describe("pointToSegmentDistance", () => {
  it("is zero for a point ON the segment", () => {
    expect(pointToSegmentDistance({ x: 5, y: 0 }, 0, 0, 10, 0)).toBe(0);
  });

  it("is the perpendicular distance for a point off the segment's middle", () => {
    expect(pointToSegmentDistance({ x: 5, y: 3 }, 0, 0, 10, 0)).toBe(3);
  });

  it("clamps to the nearest ENDPOINT beyond the segment's extent (not the infinite line)", () => {
    // Beyond x=10 -> nearest point is (10,0), not a projection past it:
    // hypot(15-10, 4-0) = hypot(5,4) = sqrt(41).
    expect(pointToSegmentDistance({ x: 15, y: 4 }, 0, 0, 10, 0)).toBeCloseTo(Math.sqrt(41), 9);
  });

  it("degrades to point distance for a zero-length segment", () => {
    expect(pointToSegmentDistance({ x: 3, y: 4 }, 0, 0, 0, 0)).toBe(5);
  });
});

describe("pointInRect", () => {
  it("is order-independent (accepts either corner order)", () => {
    expect(pointInRect({ x: 5, y: 5 }, 0, 0, 10, 10)).toBe(true);
    expect(pointInRect({ x: 5, y: 5 }, 10, 10, 0, 0)).toBe(true);
  });

  it("is false outside the rect", () => {
    expect(pointInRect({ x: 15, y: 5 }, 0, 0, 10, 10)).toBe(false);
  });

  it("is true exactly on the boundary (inclusive)", () => {
    expect(pointInRect({ x: 0, y: 0 }, 0, 0, 10, 10)).toBe(true);
    expect(pointInRect({ x: 10, y: 10 }, 0, 0, 10, 10)).toBe(true);
  });
});

describe("distanceToRectEdge", () => {
  it("is zero exactly on an edge", () => {
    expect(distanceToRectEdge({ x: 5, y: 0 }, 0, 0, 10, 10)).toBe(0);
  });

  it("is the distance to the NEAREST of the 4 segments for an interior point", () => {
    // Center of a 10x10 rect: nearest edge is 5px away on every side.
    expect(distanceToRectEdge({ x: 5, y: 5 }, 0, 0, 10, 10)).toBe(5);
  });

  it("is order-independent for the corner arguments", () => {
    expect(distanceToRectEdge({ x: 5, y: 0 }, 10, 10, 0, 0)).toBe(0);
  });
});

describe("ellipseParam / ellipseEdgeDistance", () => {
  it("param is 0 at the center, 1 exactly on the boundary", () => {
    expect(ellipseParam({ x: 5, y: 5 }, 5, 5, 3, 2)).toBe(0);
    expect(ellipseParam({ x: 8, y: 5 }, 5, 5, 3, 2)).toBeCloseTo(1, 9); // (8-5)/3 = 1
  });

  it("param > 1 outside the ellipse", () => {
    expect(ellipseParam({ x: 20, y: 5 }, 5, 5, 3, 2)).toBeGreaterThan(1);
  });

  it("is Infinity for a degenerate (zero-area) ellipse", () => {
    expect(ellipseParam({ x: 1, y: 1 }, 0, 0, 0, 5)).toBe(Infinity);
  });

  it("edge distance is ~0 exactly on the boundary, positive off it", () => {
    expect(ellipseEdgeDistance({ x: 8, y: 5 }, 5, 5, 3, 2)).toBeCloseTo(0, 6);
    expect(ellipseEdgeDistance({ x: 5, y: 5 }, 5, 5, 3, 2)).toBeCloseTo(2, 6); // center: |0-1|*min(3,2)
  });
});

describe("boundingEllipse", () => {
  it("derives center + semi-axes from two opposite corners (order-independent)", () => {
    expect(boundingEllipse(2, 4, 6, 10)).toEqual({ cx: 4, cy: 7, rx: 2, ry: 3 });
    expect(boundingEllipse(6, 10, 2, 4)).toEqual({ cx: 4, cy: 7, rx: 2, ry: 3 });
  });
});

describe("hitTestShapeBody", () => {
  const geoms: ShapeGeom[] = [
    { id: "line1", kind: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: "rect1", kind: "rect", x1: 20, y1: 20, x2: 30, y2: 30 },
    { id: "ellipse1", kind: "ellipse", x1: 40, y1: 0, x2: 48, y2: 8 },
  ];

  it("hits a line/arrow by segment distance within tolerance", () => {
    expect(hitTestShapeBody(geoms, { x: 5, y: 2 }, 8)).toBe("line1");
  });

  it("misses a line/arrow beyond tolerance", () => {
    expect(hitTestShapeBody(geoms, { x: 5, y: 20 }, 8)).toBeNull();
  });

  it("hits a rect's EDGE precisely", () => {
    expect(hitTestShapeBody(geoms, { x: 25, y: 20 }, 4)).toBe("rect1");
  });

  it("hits a rect's TRANSLUCENT INTERIOR (a click well inside, away from any edge)", () => {
    expect(hitTestShapeBody(geoms, { x: 25, y: 25 }, 4)).toBe("rect1");
  });

  it("hits an ellipse's interior", () => {
    expect(hitTestShapeBody(geoms, { x: 44, y: 4 }, 4)).toBe("ellipse1");
  });

  it("an EDGE hit always wins over an INTERIOR hit when both are candidates nearby", () => {
    // A rect and a line overlapping the same region: the line (edge-only
    // geometry) at y=0 sits exactly on a point also inside a big rect.
    const overlap: ShapeGeom[] = [
      { id: "bigrect", kind: "rect", x1: -100, y1: -100, x2: 100, y2: 100 },
      { id: "line", kind: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
    ];
    expect(hitTestShapeBody(overlap, { x: 5, y: 0 }, 8)).toBe("line");
  });

  it("among overlapping INTERIOR hits, the TOPMOST (last in the list) wins", () => {
    const stacked: ShapeGeom[] = [
      { id: "bottom", kind: "rect", x1: 0, y1: 0, x2: 100, y2: 100 },
      { id: "top", kind: "rect", x1: 10, y1: 10, x2: 50, y2: 50 },
    ];
    expect(hitTestShapeBody(stacked, { x: 25, y: 25 }, 4)).toBe("top");
  });

  it("returns null for an empty list", () => {
    expect(hitTestShapeBody([], { x: 0, y: 0 })).toBeNull();
  });

  it("skips a shape with a non-finite coordinate", () => {
    const bad: ShapeGeom[] = [{ id: "b", kind: "line", x1: NaN, y1: 0, x2: 10, y2: 0 }];
    expect(hitTestShapeBody(bad, { x: 5, y: 0 })).toBeNull();
  });
});

describe("shapeHandles", () => {
  it("gives line/arrow exactly TWO handles at its two endpoints", () => {
    expect(shapeHandles("arrow", { x1: 1, y1: 2, x2: 3, y2: 4 })).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it("gives rect/ellipse FOUR corner handles in (x1,y1)/(x2,y1)/(x2,y2)/(x1,y2) order", () => {
    expect(shapeHandles("rect", { x1: 0, y1: 0, x2: 10, y2: 20 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
  });
});

describe("hitTestShapeHandle", () => {
  const handles = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];

  it("picks the nearest handle within tolerance", () => {
    expect(hitTestShapeHandle(handles, { x: 2, y: 1 }, 8)).toBe(0);
    expect(hitTestShapeHandle(handles, { x: 97, y: 99 }, 8)).toBe(1);
  });

  it("returns null beyond tolerance", () => {
    expect(hitTestShapeHandle(handles, { x: 50, y: 50 }, 8)).toBeNull();
  });
});

describe("shapeReshapeFields", () => {
  it("line/arrow: handle 0 patches x1/y1, handle 1 patches x2/y2", () => {
    expect(shapeReshapeFields("line", 0)).toEqual({ xField: "x1", yField: "y1" });
    expect(shapeReshapeFields("arrow", 1)).toEqual({ xField: "x2", yField: "y2" });
  });

  it("rect/ellipse: each corner patches ONE x-field + ONE y-field, leaving the opposite corner untouched", () => {
    expect(shapeReshapeFields("rect", 0)).toEqual({ xField: "x1", yField: "y1" });
    expect(shapeReshapeFields("rect", 1)).toEqual({ xField: "x2", yField: "y1" });
    expect(shapeReshapeFields("ellipse", 2)).toEqual({ xField: "x2", yField: "y2" });
    expect(shapeReshapeFields("ellipse", 3)).toEqual({ xField: "x1", yField: "y2" });
  });
});
