// Drop-zone hit-testing (WORKSPACE_LAYOUT_PLAN P2): pure, no DOM.

import { describe, expect, it } from "vitest";

import { dropZoneAt, EDGE_BAND_PX } from "./dropZones";

const DESK = { x: 100, y: 50, w: 1000, h: 600 };
const at = (x: number, y: number) => dropZoneAt({ x: DESK.x + x, y: DESK.y + y }, DESK);

describe("dropZoneAt", () => {
  it("left, right and bottom bands dock to that edge", () => {
    expect(at(10, 300)).toBe("left");
    expect(at(990, 300)).toBe("right");
    expect(at(500, 590)).toBe("bottom");
  });

  it("the band is EDGE_BAND_PX wide: just inside docks, just outside does not", () => {
    expect(at(EDGE_BAND_PX, 300)).toBe("left");
    expect(at(EDGE_BAND_PX + 1, 300)).toBeNull();
    expect(at(1000 - EDGE_BAND_PX, 300)).toBe("right");
    expect(at(500, 600 - EDGE_BAND_PX)).toBe("bottom");
    expect(at(500, 600 - EDGE_BAND_PX - 1)).toBeNull();
  });

  it("left and right win over the bottom band in a corner", () => {
    expect(at(10, 590)).toBe("left");
    expect(at(990, 590)).toBe("right");
  });

  it("a small box in the middle docks to the centre; the rest of the desk floats", () => {
    expect(at(500, 300)).toBe("centre");
    expect(at(500 + 149, 300 + 89)).toBe("centre");
    expect(at(500 + 151, 300)).toBeNull();
    expect(at(500, 300 - 91)).toBeNull();
    expect(at(300, 150)).toBeNull();
  });

  it("a point outside the desk, or an empty desk, is never a zone", () => {
    expect(dropZoneAt({ x: DESK.x - 1, y: DESK.y + 300 }, DESK)).toBeNull();
    expect(dropZoneAt({ x: DESK.x + 500, y: DESK.y + 601 }, DESK)).toBeNull();
    expect(dropZoneAt({ x: 5, y: 5 }, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });

  it("on a small desk the bands stay within a quarter, leaving a middle", () => {
    const small = { x: 0, y: 0, w: 120, h: 80 };
    expect(dropZoneAt({ x: 29, y: 40 }, small)).toBe("left");
    expect(dropZoneAt({ x: 31, y: 40 }, small)).toBeNull();
    expect(dropZoneAt({ x: 60, y: 40 }, small)).toBe("centre");
  });
});
