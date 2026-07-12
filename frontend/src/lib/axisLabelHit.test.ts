import { describe, expect, it } from "vitest";

import { axisLabelRect, hitAxisLabel } from "./axisLabelHit";

describe("axisLabelRect", () => {
  it("boxes a horizontal (x) title: width runs along the advance, thin vertically", () => {
    const r = axisLabelRect(100, 400, 60, 12, false);
    expect(r.width).toBeGreaterThan(60); // advance + grab pad
    expect(r.height).toBeLessThan(r.width); // thin band vertically
    expect(r.left).toBeLessThan(100); // centered on x=100
    expect(r.left + r.width).toBeGreaterThan(100);
    expect(r.top).toBeLessThan(400);
    expect(r.top + r.height).toBeGreaterThan(400);
  });

  it("swaps span/thickness for a vertical (y) title (advance runs down the page)", () => {
    const r = axisLabelRect(40, 200, 60, 12, true);
    expect(r.height).toBeGreaterThan(60); // advance is vertical now
    expect(r.width).toBeLessThan(r.height); // thin band horizontally
    expect(r.top).toBeLessThan(200);
    expect(r.top + r.height).toBeGreaterThan(200);
  });
});

describe("hitAxisLabel", () => {
  const rects = {
    x: { left: 80, top: 390, width: 40, height: 20 },
    y: { left: 30, top: 150, width: 20, height: 100 },
  };

  it("returns the axis whose box contains the point", () => {
    expect(hitAxisLabel(rects, 100, 400)).toBe("x");
    expect(hitAxisLabel(rects, 40, 200)).toBe("y");
  });

  it("returns null outside every box", () => {
    expect(hitAxisLabel(rects, 500, 500)).toBeNull();
    expect(hitAxisLabel({}, 100, 400)).toBeNull();
  });

  it("prefers a side (y/y2) title over x when boxes overlap", () => {
    const overlap = {
      x: { left: 0, top: 0, width: 100, height: 100 },
      y: { left: 0, top: 0, width: 100, height: 100 },
    };
    expect(hitAxisLabel(overlap, 50, 50)).toBe("y");
  });
});
