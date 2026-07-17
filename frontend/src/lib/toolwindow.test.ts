// Tests for GUI_INTERACTION_PLAN #10 (floating workshops recoverable): the
// title-bar viewport clamp and the persisted-layout sanitizer.

import { describe, expect, it } from "vitest";

import {
  clampToolWindowPos,
  defaultToolWindowLayout,
  MIN_HEIGHT,
  MIN_WIDTH,
  sanitizeToolWindowLayout,
  TITLE_BAR_HEIGHT,
  type ToolWindowLayout,
} from "./toolwindow";

const VIEWPORT = { width: 1200, height: 800 };

describe("clampToolWindowPos", () => {
  it("leaves a window already fully inside the viewport untouched", () => {
    expect(clampToolWindowPos(100, 100, 360, TITLE_BAR_HEIGHT, VIEWPORT)).toEqual({ x: 100, y: 100 });
  });

  it("clamps a window dragged past the LEFT edge back to x=0", () => {
    expect(clampToolWindowPos(-500, 100, 360, TITLE_BAR_HEIGHT, VIEWPORT)).toEqual({ x: 0, y: 100 });
  });

  it("clamps a window dragged past the TOP edge back to y=0", () => {
    expect(clampToolWindowPos(100, -500, 360, TITLE_BAR_HEIGHT, VIEWPORT)).toEqual({ x: 100, y: 0 });
  });

  it("clamps the RIGHT edge so the entire title bar (full width) stays on-screen", () => {
    // width=360, viewport=1200 -> max x is 1200-360=840, not 1200 (the old
    // top-left-only clamp would have allowed x up to viewport.width).
    const { x } = clampToolWindowPos(2000, 100, 360, TITLE_BAR_HEIGHT, VIEWPORT);
    expect(x).toBe(840);
  });

  it("clamps the BOTTOM edge so the title bar's full height stays on-screen", () => {
    // titleBarHeight=32, viewport height=800 -> max y is 768.
    const { y } = clampToolWindowPos(100, 5000, 360, TITLE_BAR_HEIGHT, VIEWPORT);
    expect(y).toBe(768);
  });

  it("clamps BOTH edges at once for a window dragged fully off-screen (bottom-right)", () => {
    const c = clampToolWindowPos(9999, 9999, 360, TITLE_BAR_HEIGHT, VIEWPORT);
    expect(c).toEqual({ x: 840, y: 768 });
  });

  it("pins to the origin (best effort) when the window is wider than the viewport", () => {
    const c = clampToolWindowPos(-100, 50, 1600, TITLE_BAR_HEIGHT, VIEWPORT);
    expect(c.x).toBe(0);
  });

  it("pins to the origin (best effort) when the title bar is taller than the viewport", () => {
    const c = clampToolWindowPos(50, -100, 360, 2000, VIEWPORT);
    expect(c.y).toBe(0);
  });

  it("is a no-op on a degenerate (zero/NaN) viewport dimension", () => {
    expect(clampToolWindowPos(-50, -50, 360, TITLE_BAR_HEIGHT, { width: 0, height: 800 }).x).toBe(-50);
  });
});

describe("defaultToolWindowLayout", () => {
  it("builds an uncollapsed, auto-height layout from x/y/width", () => {
    expect(defaultToolWindowLayout(120, 90, 360)).toEqual({
      x: 120,
      y: 90,
      width: 360,
      height: null,
      collapsed: false,
    });
  });
});

describe("sanitizeToolWindowLayout", () => {
  it("returns {} for non-object input", () => {
    expect(sanitizeToolWindowLayout(null, VIEWPORT)).toEqual({});
    expect(sanitizeToolWindowLayout(undefined, VIEWPORT)).toEqual({});
    expect(sanitizeToolWindowLayout("nope", VIEWPORT)).toEqual({});
  });

  it("round-trips a well-formed entry unchanged when already in-bounds", () => {
    const raw = { baseline: { x: 200, y: 150, width: 320, height: null, collapsed: false } };
    expect(sanitizeToolWindowLayout(raw, VIEWPORT)).toEqual(raw);
  });

  it("clamps an out-of-bounds restored position to the given viewport", () => {
    const raw = { peaks: { x: 5000, y: 5000, width: 360, height: null, collapsed: true } };
    const out = sanitizeToolWindowLayout(raw, VIEWPORT);
    expect(out.peaks.x).toBe(VIEWPORT.width - 360);
    expect(out.peaks.y).toBe(VIEWPORT.height - TITLE_BAR_HEIGHT);
    // Non-geometry fields survive the clamp untouched.
    expect(out.peaks.collapsed).toBe(true);
  });

  it("drops an entry with a non-numeric x/y/width", () => {
    const raw = { bad1: { x: "nope", y: 0, width: 360 }, bad2: { x: 0, y: 0, width: "nope" } };
    expect(sanitizeToolWindowLayout(raw, VIEWPORT)).toEqual({});
  });

  it("drops an entry whose width is below the minimum", () => {
    const raw = { tiny: { x: 0, y: 0, width: MIN_WIDTH - 1 } };
    expect(sanitizeToolWindowLayout(raw, VIEWPORT)).toEqual({});
  });

  it("defaults a sub-minimum or non-numeric height to null (auto)", () => {
    const raw = { a: { x: 0, y: 0, width: 300, height: MIN_HEIGHT - 1 }, b: { x: 0, y: 0, width: 300 } };
    const out = sanitizeToolWindowLayout(raw, VIEWPORT);
    expect(out.a.height).toBeNull();
    expect(out.b.height).toBeNull();
  });

  it("defaults a missing/non-boolean collapsed to false", () => {
    const raw = { a: { x: 0, y: 0, width: 300, collapsed: "yes" } };
    const out = sanitizeToolWindowLayout(raw, VIEWPORT);
    expect(out.a.collapsed).toBe(false);
  });

  it("keeps every surviving entry independently (one bad key doesn't drop the others)", () => {
    const good: ToolWindowLayout = { x: 10, y: 10, width: 300, height: null, collapsed: false };
    const raw = { good, bad: "nope" };
    expect(sanitizeToolWindowLayout(raw, VIEWPORT)).toEqual({ good });
  });

  it("defaults the viewport to the real browser window when omitted (jsdom)", () => {
    const raw = { a: { x: -999, y: -999, width: 300 } };
    const out = sanitizeToolWindowLayout(raw);
    expect(out.a.x).toBe(0);
    expect(out.a.y).toBe(0);
  });
});
