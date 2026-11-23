// The host's pure geometry (WORKSPACE_LAYOUT_PLAN P1): edge sizes and their
// clamp, the centre grid shape, splitter share math, and the F6 order.
import { describe, expect, it } from "vitest";

import { dock, emptyLayout, float, stackOf } from "../../../lib/windowLayout/ops";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { cycleTarget, DEFAULT_EDGE, edgeSize, edgeSizes, gridColumns, MIN_EDGE, MIN_PLOT_BOTTOM, MIN_PLOT_EDGE, readingOrder, resizeShares, withEdge } from "./layoutGeometry";

const desk = { width: 1200, height: 800 };

describe("edge sizes", () => {
  it("an unsized edge uses the mockup default; a saved one wins", () => {
    const l = emptyLayout();
    expect(edgeSize(l, "right", desk)).toBe(DEFAULT_EDGE.right);
    expect(edgeSize(withEdge(l, "right", 300), "right", desk)).toBe(300);
  });

  it("clamps to the minimum and to 60% of the desk, so the centre keeps room", () => {
    const l = emptyLayout();
    expect(edgeSize(withEdge(l, "left", 10), "left", desk)).toBe(MIN_EDGE);
    expect(edgeSize(withEdge(l, "left", 5000), "left", desk)).toBe(720);
    expect(edgeSize(withEdge(l, "bottom", 5000), "bottom", desk)).toBe(480);
    // Left and right share one budget: the opposite edge's px are reserved.
    expect(edgeSize(withEdge(l, "left", 5000), "left", desk, 380)).toBe(720 - 380);
    // No desk measured yet (first render): only the minimum applies.
    expect(edgeSize(withEdge(l, "left", 5000), "left", null)).toBe(5000);
  });

  it("withEdge returns the same layout when nothing changes", () => {
    const l = withEdge(emptyLayout(), "left", 300);
    expect(withEdge(l, "left", 300)).toBe(l);
  });
});

describe("edge sizes with a plot window docked (M2, M3)", () => {
  const l = emptyLayout();
  const narrow = { width: 814, height: 642 }; // a 1024 px window beside the Library
  const none = { left: false, right: false, bottom: false };

  it("a plot on the left keeps its minimum width while Style on the right gives way", () => {
    const sizes = edgeSizes(l, narrow, { ...none, left: true, right: true }, { ...none, left: true });
    expect(sizes.left).toBeGreaterThanOrEqual(MIN_PLOT_EDGE);
    expect(sizes.right).toBeGreaterThanOrEqual(MIN_EDGE);
    expect(sizes.left + sizes.right).toBeLessThanOrEqual(Math.floor(narrow.width * 0.6) + 1);
  });

  it("when the minimums do not fit the 60% budget the centre shrinks, never a dock", () => {
    const tiny = { width: 500, height: 400 };
    const sizes = edgeSizes(l, tiny, { ...none, left: true, right: true }, { ...none, left: true, right: true });
    expect(sizes.left).toBe(MIN_PLOT_EDGE);
    expect(sizes.right).toBe(MIN_PLOT_EDGE);
  });

  it("a docked plot on its own is never narrower than the plot minimum, and a non-plot edge may be smaller", () => {
    const savedSmall = withEdge(l, "left", 210);
    expect(edgeSizes(savedSmall, narrow, { ...none, left: true }, { ...none, left: true }).left).toBe(MIN_PLOT_EDGE);
    expect(edgeSizes(savedSmall, narrow, { ...none, left: true }, none).left).toBe(210);
  });

  it("the bottom dock is taller by default and holds at least the plot minimum", () => {
    expect(DEFAULT_EDGE.bottom).toBeGreaterThanOrEqual(320);
    const small = withEdge(l, "bottom", MIN_EDGE);
    expect(edgeSizes(small, narrow, { ...none, bottom: true }, { ...none, bottom: true }).bottom).toBe(MIN_PLOT_BOTTOM);
  });
});

describe("centre grid", () => {
  it("side by side up to three windows, then two columns", () => {
    expect([1, 2, 3, 4, 5, 6].map(gridColumns)).toEqual([1, 2, 3, 2, 2, 2]);
  });
});

describe("resizeShares (a splitter between stacked windows)", () => {
  const two = () => dock(dock(emptyLayout(), "style", "right"), "tool:fit", "right");

  it("moves the boundary and keeps the slot summing to 1", () => {
    const l = resizeShares(two(), "right", "style", "tool:fit", 100, 1000);
    expect(l.placements.style!.share).toBeCloseTo(0.6);
    expect(l.placements["tool:fit"]!.share).toBeCloseTo(0.4);
    checkInvariants(l);
  });

  it("moves the pair it names even when a hidden window sits between them in the stack", () => {
    const l = dock(dock(dock(emptyLayout(), "plot:hidden", "centre"), "plot:b", "centre"), "plot:c", "centre");
    const next = resizeShares(l, "centre", "plot:b", "plot:c", 100, 1000);
    expect(next.placements["plot:hidden"]!.share).toBe(l.placements["plot:hidden"]!.share);
    expect(next.placements["plot:b"]!.share).toBeCloseTo(l.placements["plot:b"]!.share + 0.1);
    checkInvariants(next);
  });

  it("never shrinks a window below the minimum length", () => {
    const l = resizeShares(two(), "right", "style", "tool:fit", 5000, 1000);
    expect(l.placements["tool:fit"]!.share).toBeCloseTo(0.08);
    checkInvariants(l);
  });

  it("is a no-op for a missing neighbour, zero delta or an unmeasured stack", () => {
    const l = two();
    expect(resizeShares(l, "right", "tool:fit", "tool:gone", 50, 1000)).toBe(l);
    expect(resizeShares(l, "right", "style", "tool:fit", 0, 1000)).toBe(l);
    expect(resizeShares(l, "right", "style", "tool:fit", 50, 0)).toBe(l);
    expect(resizeShares(l, "left", "style", "tool:fit", 50, 1000)).toBe(l);
  });
});

describe("reading order (F6)", () => {
  const layout = () => {
    let l = dock(emptyLayout(), "plot:b", "centre");
    l = dock(l, "plot:a", "centre", 0);
    l = dock(l, "style", "right");
    l = dock(l, "tool:x", "bottom");
    l = dock(l, "tool:l", "left");
    l = float(l, "plot:f1");
    return float(l, "plot:f2");
  };

  it("left, centre left to right, right, bottom, then floating back to front", () => {
    expect(stackOf(layout(), "centre")).toEqual(["plot:a", "plot:b"]);
    expect(readingOrder(layout())).toEqual(["tool:l", "plot:a", "plot:b", "style", "tool:x", "plot:f1", "plot:f2"]);
  });

  it("drops windows that are not on screen", () => {
    expect(readingOrder(layout(), (r) => r !== "plot:b")).not.toContain("plot:b");
  });

  it("cycles forward and back, wrapping, and starts at an end from outside", () => {
    const order = ["a", "b", "c"];
    expect(cycleTarget(order, "a", 1)).toBe("b");
    expect(cycleTarget(order, "c", 1)).toBe("a");
    expect(cycleTarget(order, "a", -1)).toBe("c");
    expect(cycleTarget(order, null, 1)).toBe("a");
    expect(cycleTarget(order, null, -1)).toBe("c");
    expect(cycleTarget([], null, 1)).toBeNull();
  });
});
