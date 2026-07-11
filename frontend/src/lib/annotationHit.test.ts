// lib/annotationHit — pure point/rect hit-test geometry for pointer-mode
// annotation direct manipulation (MAIN #18). No canvas/DOM involved; the
// interactive-plugin gesture contract itself is covered in
// uplotOverlays.test.ts (the "pointer-mode interactive" describe block).

import { describe, expect, it } from "vitest";

import {
  canvasToOverCss,
  hitTestAnnotationBody,
  hitTestAnnotationHandle,
  overPointerToCanvas,
  type AnnotationHitGeometry,
} from "./annotationHit";

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

// The 2026-07-11 owner-reported regression: pointer events are CSS px
// (relative to u.over) but annotationLayout geometry is CANVAS px (DPR-scaled
// + bbox-offset). At Windows 125-150% display scaling the un-converted CSS
// pointer never landed inside a label's canvas-px box, so "drag the 700 mT
// label" fell through to box zoom.
describe("overPointerToCanvas (frame conversion)", () => {
  // DPR-2 canvas with an axes gutter: plot area is 200x160 canvas px starting
  // at canvas (40, 20); the same area is 100x80 CSS px in the over element.
  const bbox = { left: 40, top: 20, width: 200, height: 160 };
  const rect = { width: 100, height: 80 };

  it("maps CSS px into the canvas frame (offset + scale) and reports the scale", () => {
    const p = overPointerToCanvas(bbox, rect, 10, 10);
    expect(p).toEqual({ x: 60, y: 40, scale: 2 });
  });

  it("is the identity at scale 1 with a zero gutter", () => {
    const p = overPointerToCanvas({ left: 0, top: 0, width: 100, height: 80 }, rect, 33, 44);
    expect(p).toEqual({ x: 33, y: 44, scale: 1 });
  });

  it("falls back to scale 1 on a degenerate rect (jsdom, not laid out)", () => {
    const p = overPointerToCanvas(bbox, { width: 0, height: 0 }, 5, 7);
    expect(p.scale).toBe(1);
    expect(p).toEqual({ x: 45, y: 27, scale: 1 });
  });

  it("REGRESSION: at DPR 2 the converted pointer hits a label the raw CSS pointer misses", () => {
    // A label drawn at canvas px (160, 100) with a 60x20 canvas-px box; the
    // user clicks its CSS-space center (that is CSS (55, 35) in the over).
    const geoms: AnnotationHitGeometry[] = [
      { id: "field-label", px: 150, py: 90, box: { left: 160, top: 100, width: 60, height: 20 } },
    ];
    const cssPointer = { x: 55, y: 35 };
    // Old behaviour (the bug): comparing CSS px straight against canvas-px
    // geometry misses entirely.
    expect(hitTestAnnotationBody(geoms, cssPointer)).toBeNull();
    // Fixed behaviour: convert first, then it lands inside the box.
    const p = overPointerToCanvas(bbox, rect, cssPointer.x, cssPointer.y);
    expect(hitTestAnnotationBody(geoms, p, 8 * p.scale)).toBe("field-label");
  });
});

// MAIN #21 (page-anchored annotations): the data<->page anchor toggle needs
// to convert a CANVAS pixel back to the CSS px relative to `over` that
// `u.posToVal` expects — the inverse of `overPointerToCanvas`'s ROOT-relative
// forward conversion. Pure (plain rect records), so the round-trip is
// unit-testable without any live layout engine.
describe("canvasToOverCss (inverse of overPointerToCanvas)", () => {
  it("round-trips with overPointerToCanvas when over coincides with root", () => {
    const canvas = { width: 200, height: 160 };
    const rootRect = { width: 100, height: 80, left: 0, top: 0 };
    const overRect = { left: 0, top: 0 }; // over exactly coincides with root
    const canvasPx = overPointerToCanvas({ left: 0, top: 0, ...canvas }, rootRect, 33, 44);
    const back = canvasToOverCss({ x: canvasPx.x, y: canvasPx.y }, canvas, rootRect, overRect);
    expect(back.x).toBeCloseTo(33);
    expect(back.y).toBeCloseTo(44);
  });

  it("subtracts the over element's offset from root (over does NOT coincide with root)", () => {
    const canvas = { width: 100, height: 100 };
    const rootRect = { width: 100, height: 100, left: 10, top: 20 };
    const overRect = { left: 15, top: 25 }; // over sits 5px right, 5px down from root
    // canvas px (50, 50) is CSS (50, 50) relative to root at scale 1;
    // relative to over (offset +5, +5 from root) that's (45, 45).
    expect(canvasToOverCss({ x: 50, y: 50 }, canvas, rootRect, overRect)).toEqual({ x: 45, y: 45 });
  });

  it("falls back to scale 1 on a degenerate rect (jsdom, not laid out)", () => {
    const back = canvasToOverCss(
      { x: 40, y: 30 },
      { width: 200, height: 160 },
      { width: 0, height: 0, left: 0, top: 0 },
      { left: 0, top: 0 },
    );
    expect(back).toEqual({ x: 40, y: 30 });
  });
});
