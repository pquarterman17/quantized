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
