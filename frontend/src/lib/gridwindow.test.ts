import { describe, expect, it } from "vitest";

import { computeAxisWindow, windowIndices } from "./gridwindow";

describe("computeAxisWindow", () => {
  it("windows from the top when scrolled to 0", () => {
    const w = computeAxisWindow(0, 100, 50, { itemSize: 20 });
    // 100/20 = 5 visible + 1 trailing-partial buffer.
    expect(w).toEqual({ start: 0, end: 6, offset: 0, totalSize: 1000 });
  });

  it("windows to the exact end at the bottom of the scroll range, never overshooting", () => {
    // itemCount=50, itemSize=20 -> totalSize=1000; viewport=100 -> max scroll=900.
    const w = computeAxisWindow(900, 100, 50, { itemSize: 20 });
    expect(w.start).toBe(45);
    expect(w.end).toBe(50); // clamped — never exceeds itemCount
    expect(w.offset).toBe(900);
  });

  it("an exact-fit viewport (evenly divisible) still windows within range", () => {
    // viewport is exactly 5 rows; still renders the +1 partial-trailing buffer.
    const w = computeAxisWindow(0, 100, 5, { itemSize: 20 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(5); // clamped to itemCount even though the buffer wants 6
  });

  it("a tiny viewport (smaller than one item) still renders at least one item plus buffer", () => {
    const w = computeAxisWindow(0, 5, 50, { itemSize: 20 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(2);
  });

  it("applies overscan symmetrically around the visible range", () => {
    const w = computeAxisWindow(200, 100, 50, { itemSize: 20, overscan: 2 });
    // visible rows 10..14 (200/20=10, 100/20=5 visible) widened by 2 each side.
    expect(w.start).toBe(8);
    expect(w.end).toBe(18);
    expect(w.offset).toBe(160);
  });

  it("clamps overscan at the top so start never goes negative", () => {
    const w = computeAxisWindow(0, 100, 50, { itemSize: 20, overscan: 3 });
    expect(w.start).toBe(0);
    expect(w.offset).toBe(0);
  });

  it("degenerate viewport (jsdom: 0 height/width) falls back to a fixed window from the top", () => {
    const w = computeAxisWindow(0, 0, 1000, { itemSize: 20, fallbackCount: 50 });
    expect(w).toEqual({ start: 0, end: 50, offset: 0, totalSize: 20000 });
  });

  it("degenerate viewport renders every item when the fallback exceeds the item count", () => {
    const w = computeAxisWindow(0, 0, 3, { itemSize: 20, fallbackCount: 300 });
    expect(w).toEqual({ start: 0, end: 3, offset: 0, totalSize: 60 });
  });

  it("degenerate viewport with no fallbackCount renders everything", () => {
    const w = computeAxisWindow(0, 0, 7, { itemSize: 20 });
    expect(w.end).toBe(7);
  });

  it("an empty axis (itemCount 0) windows to nothing, degenerate or not", () => {
    expect(computeAxisWindow(0, 100, 0, { itemSize: 20 })).toEqual({
      start: 0, end: 0, offset: 0, totalSize: 0,
    });
    expect(computeAxisWindow(0, 0, 0, { itemSize: 20 })).toEqual({
      start: 0, end: 0, offset: 0, totalSize: 0,
    });
  });

  it("treats a non-positive itemSize as 1px rather than dividing by zero", () => {
    expect(() => computeAxisWindow(0, 100, 10, { itemSize: 0 })).not.toThrow();
    const w = computeAxisWindow(0, 100, 10, { itemSize: -5 });
    expect(w.totalSize).toBe(10);
  });

  it("negative scroll offsets (elastic overscroll) clamp to 0 instead of going negative", () => {
    const w = computeAxisWindow(-50, 100, 50, { itemSize: 20 });
    expect(w.start).toBe(0);
    expect(w.offset).toBe(0);
  });
});

describe("windowIndices", () => {
  it("expands a window to a plain index array", () => {
    expect(windowIndices({ start: 2, end: 5 })).toEqual([2, 3, 4]);
  });

  it("is empty when start === end", () => {
    expect(windowIndices({ start: 3, end: 3 })).toEqual([]);
  });
});
