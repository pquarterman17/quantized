import { describe, expect, it } from "vitest";

import { closeProblem, moveVertex, onOutline, polygonRefusal, polygonRegion, polygonToPx, signedArea, vertexAt, type RoiPolygon } from "./roiPolygon";

const tri: RoiPolygon = { space: "map", axes: ["A", "B"], points: [[0, 0], [4, 0], [2, 3]] };

describe("roiPolygon geometry", () => {
  it("shoelace area, signed by winding", () => {
    expect(signedArea(tri.points)).toBeCloseTo(6, 12);
    expect(signedArea([...tri.points].reverse())).toBeCloseTo(-6, 12);
  });

  it("refuses to close fewer than three vertices, a non-finite one, or a collinear outline", () => {
    expect(closeProblem([[0, 0], [1, 1]])).toMatch(/at least 3 vertices \(2 so far\)/);
    expect(closeProblem([[0, 0], [1, NaN], [2, 0]])).toMatch(/not a finite number/);
    expect(closeProblem([[0, 0], [1, 1], [2, 2]])).toMatch(/lie on a line/);
    expect(closeProblem(tri.points)).toBeNull();
  });

  it("projects every vertex, or none when one falls outside the plot", () => {
    const project = (x: number, y: number): [number, number] | null => (x > 3 ? null : [x * 10, y * 10]);
    expect(polygonToPx([[0, 0], [1, 2]], project)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 20 }]);
    expect(polygonToPx([[0, 0], [5, 2]], project)).toBeNull();
  });

  it("finds the nearest vertex within the radius, and the outline", () => {
    const px = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }];
    expect(vertexAt(px, { x: 42, y: 3 })).toBe(1);
    expect(vertexAt(px, { x: 20, y: 0 })).toBe(-1);
    expect(onOutline(px, { x: 20, y: 2 })).toBe(true);
    expect(onOutline(px, { x: 20, y: 12 })).toBe(false);
  });

  it("moves one vertex without touching the original", () => {
    const moved = moveVertex(tri, 2, 9, 9);
    expect(moved.points).toEqual([[0, 0], [4, 0], [9, 9]]);
    expect(tri.points[2]).toEqual([2, 3]);
    expect(moved.axes).toEqual(["A", "B"]);
  });

  it("is the backend's polygon region, and its refusal names what needs a rectangle", () => {
    expect(polygonRegion(tri)).toEqual({ kind: "polygon", points: [[0, 0], [4, 0], [2, 3]] });
    expect(polygonRefusal("Crop")).toMatch(/not a box: Crop needs a rectangle/);
  });
});
