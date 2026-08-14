// Moved out of plotview.test.ts alongside the snap functions themselves
// (F2.3j) — see windowSnap.ts's module doc for why.

import { describe, expect, it } from "vitest";

import type { WindowGeometry } from "./plotview";
import { SNAP_THRESHOLD, snapMovePosition, snapResizeSize } from "./windowSnap";

describe("snapMovePosition / snapResizeSize (item 12 — edge/sibling snapping)", () => {
  const bounds = { width: 800, height: 600 };
  const rect = (x: number, y: number, w = 200, h = 150): WindowGeometry => ({ x, y, w, h });

  it("snaps a move to the canvas edges on all four sides", () => {
    expect(snapMovePosition(rect(5, 300), bounds, [])).toEqual({ x: 0, y: 300 }); // left
    expect(snapMovePosition(rect(300, 6), bounds, [])).toEqual({ x: 300, y: 0 }); // top
    expect(snapMovePosition(rect(595, 300), bounds, [])).toEqual({ x: 600, y: 300 }); // right: 795 → 800
    expect(snapMovePosition(rect(300, 444), bounds, [])).toEqual({ x: 300, y: 450 }); // bottom: 594 → 600
  });

  it("aligns to a sibling's same edge (left-to-left)", () => {
    const sib = rect(100, 100);
    expect(snapMovePosition({ x: 106, y: 300, w: 240, h: 150 }, undefined, [sib])).toEqual({
      x: 100,
      y: 300,
    });
  });

  it("abuts a sibling in both directions (our left to its right; our right to its left)", () => {
    const sib = rect(100, 100); // spans x 100..300
    // Our left edge 305 → the sibling's right edge 300.
    expect(snapMovePosition({ x: 305, y: 400, w: 240, h: 100 }, undefined, [sib])).toEqual({
      x: 300,
      y: 400,
    });
    // Our right edge 95 → the sibling's left edge 100.
    expect(snapMovePosition({ x: 55, y: 400, w: 40, h: 40 }, undefined, [sib])).toEqual({
      x: 60,
      y: 400,
    });
  });

  it("does not snap outside the threshold (and snaps at exactly the threshold)", () => {
    expect(SNAP_THRESHOLD).toBe(8);
    expect(snapMovePosition(rect(9, 300), bounds, [])).toEqual({ x: 9, y: 300 });
    expect(snapMovePosition(rect(8, 300), bounds, []).x).toBe(0);
  });

  it("the nearest candidate wins when several lines are in range", () => {
    const sib = rect(11, 100); // sibling left edge at 11
    // Proposed left edge 6: canvas left (0) is 6 away, the sibling's left
    // (11) is 5 away — the sibling wins.
    expect(snapMovePosition({ x: 6, y: 300, w: 240, h: 150 }, bounds, [sib]).x).toBe(11);
  });

  it("x and y snap independently of each other", () => {
    const sib = rect(100, 100);
    // x in reach of the sibling's left edge; y far from every line.
    expect(snapMovePosition({ x: 95, y: 350, w: 240, h: 100 }, bounds, [sib])).toEqual({
      x: 100,
      y: 350,
    });
    // y in reach of the sibling's top edge; x far from every line.
    expect(snapMovePosition({ x: 400, y: 94, w: 240, h: 100 }, bounds, [sib])).toEqual({
      x: 400,
      y: 100,
    });
  });

  it("snapResizeSize snaps only the moving right/bottom edges", () => {
    // Right edge 795 → canvas 800; bottom edge 596 → canvas 600.
    expect(snapResizeSize({ x: 300, y: 200, w: 495, h: 396 }, bounds, [])).toEqual({
      w: 500,
      h: 400,
    });
    // The ANCHORED left/top edges being near a line must NOT change the size.
    expect(snapResizeSize({ x: 5, y: 5, w: 400, h: 300 }, bounds, [])).toEqual({ w: 400, h: 300 });
  });

  it("snapResizeSize abuts sibling edges (right→its left, bottom→its top)", () => {
    const sib = rect(500, 300);
    expect(snapResizeSize({ x: 100, y: 100, w: 395, h: 195 }, undefined, [sib])).toEqual({
      w: 400,
      h: 200,
    });
  });

  it("with no bounds and no siblings the geometry is unchanged", () => {
    expect(snapMovePosition(rect(5, 5), undefined, [])).toEqual({ x: 5, y: 5 });
    expect(snapResizeSize(rect(5, 5), undefined, [])).toEqual({ w: 200, h: 150 });
  });
});
