// lib/annotationHit — pure point/rect hit-test geometry for pointer-mode
// annotation direct manipulation (MAIN #18). No canvas/DOM involved; the
// interactive-plugin gesture contract itself is covered in
// uplotOverlays.test.ts (the "pointer-mode interactive" describe block).

import { describe, expect, it } from "vitest";

import { hitTestAnnotationBody, hitTestAnnotationHandle, type AnnotationHitGeometry } from "./annotationHit";

describe("hitTestAnnotationBody", () => {
  const geoms: AnnotationHitGeometry[] = [
    { id: "dot-only", px: 10, py: 10, box: { left: 0, top: 0, width: 0, height: 0 } },
    { id: "labeled", px: 100, py: 100, box: { left: 106, top: 90, width: 40, height: 14 } },
  ];

  it("hits the dot within tolerance", () => {
    expect(hitTestAnnotationBody(geoms, { x: 12, y: 10 })).toBe("dot-only");
  });

  it("returns null when nothing is within tolerance", () => {
    expect(hitTestAnnotationBody(geoms, { x: 500, y: 500 })).toBeNull();
  });

  it("falls back to a rect hit when the dot is out of range but the pointer is inside the label box", () => {
    expect(hitTestAnnotationBody(geoms, { x: 120, y: 95 })).toBe("labeled");
  });

  it("prefers the (closer, more precise) dot over a rect hit when both qualify", () => {
    const overlapping: AnnotationHitGeometry[] = [
      { id: "dot", px: 50, py: 50, box: { left: 0, top: 0, width: 0, height: 0 } },
      { id: "rect", px: 500, py: 500, box: { left: 40, top: 40, width: 20, height: 20 } },
    ];
    // (50,50) is both within 8px of the dot AND inside the rect [40..60]x[40..60].
    expect(hitTestAnnotationBody(overlapping, { x: 50, y: 50 })).toBe("dot");
  });

  it("skips a zero-area box (no text) for the rect test — only the dot can hit it", () => {
    expect(hitTestAnnotationBody(geoms, { x: 10, y: 10 })).toBe("dot-only"); // via the dot, not the box
    expect(hitTestAnnotationBody(geoms, { x: 106, y: 90 })).toBe("labeled"); // top-left corner of the rect
  });

  it("ignores a non-finite dot position", () => {
    const nan: AnnotationHitGeometry[] = [
      { id: "bad", px: Number.NaN, py: 10, box: { left: 0, top: 0, width: 0, height: 0 } },
    ];
    expect(hitTestAnnotationBody(nan, { x: 0, y: 10 })).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(hitTestAnnotationBody([], { x: 0, y: 0 })).toBeNull();
  });

  it("respects a custom dot tolerance", () => {
    expect(hitTestAnnotationBody(geoms, { x: 15, y: 10 }, 2)).toBeNull();
    expect(hitTestAnnotationBody(geoms, { x: 15, y: 10 }, 10)).toBe("dot-only");
  });
});

describe("hitTestAnnotationHandle", () => {
  it("hits within tolerance of the handle position", () => {
    expect(hitTestAnnotationHandle({ x: 20, y: 20 }, { x: 24, y: 20 })).toBe(true);
  });

  it("misses beyond tolerance", () => {
    expect(hitTestAnnotationHandle({ x: 20, y: 20 }, { x: 40, y: 20 })).toBe(false);
  });

  it("is always false for a null handle (no selection, or an off-panel selection)", () => {
    expect(hitTestAnnotationHandle(null, { x: 20, y: 20 })).toBe(false);
  });

  it("respects a custom tolerance", () => {
    expect(hitTestAnnotationHandle({ x: 0, y: 0 }, { x: 5, y: 0 }, 3)).toBe(false);
    expect(hitTestAnnotationHandle({ x: 0, y: 0 }, { x: 5, y: 0 }, 6)).toBe(true);
  });
});
