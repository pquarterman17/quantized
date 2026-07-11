import { describe, expect, it } from "vitest";

import {
  autofitColWidth,
  buildOffsets,
  clampColWidth,
  computeAxisWindow,
  computeAxisWindowOffsets,
  DEFAULT_COL_WIDTH,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  offsetIndexAt,
  windowIndices,
} from "./gridwindow";

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

// ── Variable per-column widths (MAIN_PLAN #3) ────────────────────────────────

describe("buildOffsets / offsetIndexAt", () => {
  it("builds prefix sums with offsets[0]=0 and offsets[n]=total", () => {
    expect(buildOffsets(3, (i) => [100, 50, 200][i])).toEqual([0, 100, 150, 350]);
  });

  it("treats non-positive sizes as 1px (same defensive rule as the uniform path)", () => {
    expect(buildOffsets(2, () => 0)).toEqual([0, 1, 2]);
  });

  it("an empty axis yields just the zero anchor", () => {
    expect(buildOffsets(0, () => 100)).toEqual([0]);
  });

  it("binary-searches the item under a pixel position (start-inclusive)", () => {
    const offsets = [0, 100, 150, 350];
    expect(offsetIndexAt(offsets, 0)).toBe(0);
    expect(offsetIndexAt(offsets, 99)).toBe(0);
    expect(offsetIndexAt(offsets, 100)).toBe(1); // exactly at item 1's start
    expect(offsetIndexAt(offsets, 149)).toBe(1);
    expect(offsetIndexAt(offsets, 150)).toBe(2);
    expect(offsetIndexAt(offsets, 10_000)).toBe(2); // past the end clamps to the last item
    expect(offsetIndexAt(offsets, -5)).toBe(0);
  });
});

describe("computeAxisWindowOffsets", () => {
  it("matches the uniform path when every width is equal", () => {
    const offsets = buildOffsets(50, () => 20);
    const variable = computeAxisWindowOffsets(200, 100, offsets, {});
    const uniform = computeAxisWindow(200, 100, 50, { itemSize: 20 });
    expect(variable).toEqual(uniform);
  });

  it("windows across mixed widths with the leading offset at the first rendered item", () => {
    // widths: 10 × [100, 50, 200, 100, 50, 200, ...]; scroll 160 lands inside
    // item 2 (starts at 150), viewport 300 reaches into item 4 (starts 450).
    const widths = [100, 50, 200, 100, 50, 200, 100, 50, 200, 100];
    const offsets = buildOffsets(widths.length, (i) => widths[i]);
    const w = computeAxisWindowOffsets(160, 300, offsets, {});
    expect(w.start).toBe(2);
    expect(w.offset).toBe(150);
    expect(w.end).toBeGreaterThanOrEqual(5); // items 2..4 visible + trailing buffer
    expect(w.totalSize).toBe(offsets[widths.length]);
  });

  it("applies overscan symmetrically and clamps at both ends", () => {
    const offsets = buildOffsets(6, () => 100);
    const top = computeAxisWindowOffsets(0, 100, offsets, { overscan: 3 });
    expect(top.start).toBe(0);
    expect(top.offset).toBe(0);
    const bottom = computeAxisWindowOffsets(500, 100, offsets, { overscan: 3 });
    expect(bottom.end).toBe(6); // never past itemCount
  });

  it("degenerate viewport falls back to a fixed window from the top", () => {
    const offsets = buildOffsets(1000, () => 20);
    const w = computeAxisWindowOffsets(0, 0, offsets, { fallbackCount: 50 });
    expect(w).toEqual({ start: 0, end: 50, offset: 0, totalSize: 20_000 });
  });

  it("an empty axis windows to nothing", () => {
    expect(computeAxisWindowOffsets(0, 100, [0], {})).toEqual({
      start: 0, end: 0, offset: 0, totalSize: 0,
    });
  });
});

describe("clampColWidth / autofitColWidth", () => {
  it("clamps a dragged width into [MIN, MAX] and rounds it", () => {
    expect(clampColWidth(3)).toBe(MIN_COL_WIDTH);
    expect(clampColWidth(1e6)).toBe(MAX_COL_WIDTH);
    expect(clampColWidth(120.6)).toBe(121);
    expect(clampColWidth(Number.NaN)).toBe(DEFAULT_COL_WIDTH);
  });

  it("autofit grows with the longest sample and stays clamped", () => {
    const short = autofitColWidth(["1.0"]);
    const long = autofitColWidth(["1.0", "-1.234e+56 something long"]);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(MAX_COL_WIDTH);
    expect(short).toBeGreaterThanOrEqual(MIN_COL_WIDTH);
  });

  it("autofit of no content falls back to the default width", () => {
    expect(autofitColWidth([])).toBe(DEFAULT_COL_WIDTH);
    expect(autofitColWidth(["", ""])).toBe(DEFAULT_COL_WIDTH);
  });
});
