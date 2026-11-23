// A floating plot window that opens under a floating tool window is moved beside it (UX pass 4 M5).
import { describe, expect, it } from "vitest";

import { CLEAR_GAP, clearOfBoxes, MIN_CLEAR_W, type Box } from "./clearance";

const DESK = { w: 814 };
const style: Box = { x: 474, y: 36, w: 332, h: 500 };

describe("clearOfBoxes", () => {
  it("leaves a window nothing covers (the same object)", () => {
    const win: Box = { x: 20, y: 40, w: 400, h: 300 };
    expect(clearOfBoxes(win, [style], DESK)).toBe(win);
    expect(clearOfBoxes(win, [], DESK)).toBe(win);
    // below the tool window's rows: not covered either
    const below: Box = { x: 500, y: 600, w: 200, h: 100 };
    expect(clearOfBoxes(below, [style], DESK)).toBe(below);
  });

  it("moves a window that opens under Style into the free band beside it, keeping its size", () => {
    const win: Box = { x: 410, y: 40, w: 300, h: 300 };
    const next = clearOfBoxes(win, [style], DESK);
    expect(next.w).toBe(300);
    expect(next.x + next.w).toBeLessThanOrEqual(style.x - CLEAR_GAP);
    expect(next.y).toBe(win.y);
  });

  it("narrows a window that is too wide for the band, down to the band", () => {
    const win: Box = { x: 100, y: 40, w: 480, h: 300 };
    const next = clearOfBoxes(win, [style], DESK);
    expect(next.x).toBe(0);
    expect(next.x + next.w).toBeLessThanOrEqual(style.x - CLEAR_GAP);
    expect(next.w).toBeGreaterThanOrEqual(MIN_CLEAR_W);
  });

  it("uses the band to the right when that is the roomy one", () => {
    const left: Box = { x: 0, y: 36, w: 600, h: 500 };
    const win: Box = { x: 100, y: 40, w: 180, h: 300 };
    const next = clearOfBoxes(win, [left], { w: 1400 });
    expect(next.x).toBeGreaterThanOrEqual(left.x + left.w + CLEAR_GAP);
    expect(next.w).toBe(180);
  });

  it("leaves the overlap alone when no band is wide enough (never made worse)", () => {
    const win: Box = { x: 100, y: 40, w: 480, h: 300 };
    const wall: Box = { x: 120, y: 0, w: 700, h: 700 };
    expect(clearOfBoxes(win, [wall], DESK)).toBe(win);
  });

  it("ignores zero-size boxes (an unmeasured tool window)", () => {
    const win: Box = { x: 410, y: 40, w: 300, h: 300 };
    expect(clearOfBoxes(win, [{ x: 0, y: 0, w: 0, h: 0 }], DESK)).toBe(win);
  });
});
