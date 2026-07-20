import { describe, expect, it } from "vitest";

import { annotationKey, layoutPlotObjects, shapeKey } from "./plotObjectLayout";
import type { Annotation, Shape } from "./types";

const annotations: Annotation[] = [
  { id: "a1", x: 1, y: 4, text: "A" },
  { id: "a2", x: 5, y: 8, text: "B" },
  { id: "a3", x: 9, y: 5, text: "C" },
];
const shapes: Shape[] = [
  { id: "s1", kind: "rect", x1: 3, y1: 2, x2: 7, y2: 6 },
];

describe("layoutPlotObjects", () => {
  it("aligns point and bounded objects by translating their geometry", () => {
    const selected = new Set([annotationKey("a1"), shapeKey("s1")]);
    const result = layoutPlotObjects(annotations, shapes, selected, "left");
    expect(result.annotations.a1).toEqual({ x: 1, y: 4 });
    expect(result.shapes.s1).toEqual({ x1: 1, x2: 5, y1: 2, y2: 6 });
  });

  it("distributes three centers evenly while preserving endpoints", () => {
    const uneven = annotations.map((a, i) => ({ ...a, x: [1, 3, 9][i] }));
    const selected = new Set(unevenKeys());
    const result = layoutPlotObjects(uneven, [], selected, "distribute-h");
    expect(result.annotations.a1.x).toBe(1);
    expect(result.annotations.a2.x).toBe(5);
    expect(result.annotations.a3.x).toBe(9);
  });

  it("keeps page-anchored objects inside [0,1] when centring mixed widths", () => {
    // hcenter targets the mean of the CENTRES, ignoring extent, so the wide
    // rect's right edge was pushed to 1.1625 — off-canvas, and silently
    // re-clamped by sanitizeShapes on the next .dwk round-trip.
    const page: Shape[] = [
      { id: "wide", kind: "rect", anchor: "page", x1: 0, x2: 0.9, y1: 0, y2: 0.2 },
      { id: "narrow", kind: "rect", anchor: "page", x1: 0.95, x2: 1, y1: 0.5, y2: 0.6 },
    ];
    const result = layoutPlotObjects([], page, new Set([shapeKey("wide"), shapeKey("narrow")]), "hcenter");
    for (const patch of Object.values(result.shapes)) {
      for (const v of [patch.x1, patch.x2, patch.y1, patch.y2]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Clamped by DELTA, so the wide rect keeps its 0.9 width.
    expect((result.shapes.wide.x2 as number) - (result.shapes.wide.x1 as number)).toBeCloseTo(0.9, 10);
  });

  it("rejects mixed coordinate spaces and fewer than three distribution targets", () => {
    const page = [{ ...annotations[0], anchor: "page" as const }];
    expect(layoutPlotObjects(page, shapes, new Set([annotationKey("a1"), shapeKey("s1")]), "top").error)
      .toMatch(/cannot be aligned/);
    expect(layoutPlotObjects(annotations, [], new Set([annotationKey("a1"), annotationKey("a2")]), "distribute-v").error)
      .toMatch(/three/);
  });
});

function unevenKeys() {
  return [annotationKey("a1"), annotationKey("a2"), annotationKey("a3")];
}
