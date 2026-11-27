// The split violin's legend: top right as the other stat legends, or the least
// covered corner when shapes lie under it.

import { describe, expect, it } from "vitest";

import { legendSpot } from "./statLegendSpot";

const RECT = { x: 60, y: 20, w: 520, h: 332 };
const TR = { x: 60 + 520 - 120, y: 30 };

describe("legendSpot", () => {
  it("keeps the top-right corner when nothing is under it", () => {
    expect(legendSpot(RECT, 2, [[100, 200], [300, 300]])).toEqual(TR);
    expect(legendSpot(RECT, 2, [])).toEqual(TR);
  });

  it("moves to the next free corner when a shape lies under the top-right key", () => {
    const spot = legendSpot(RECT, 2, [[TR.x + 20, TR.y + 4]]);
    expect(spot).toEqual({ x: RECT.x + 8, y: 30 }); // top left
    const both = legendSpot(RECT, 2, [[TR.x + 20, TR.y + 4], [RECT.x + 20, 35]]);
    expect(both.y).toBe(RECT.y + RECT.h - 10 - 16); // bottom: the last row sits 10 px above the frame
  });

  it("takes the least covered corner when every corner has a shape under it", () => {
    const crowd = [
      [TR.x + 5, 32], [TR.x + 6, 33], // top right: 2
      [RECT.x + 20, 32], // top left: 1
      [TR.x + 5, 330], [TR.x + 9, 331], // bottom right: 2
      [RECT.x + 20, 330], [RECT.x + 22, 331], [RECT.x + 30, 330], // bottom left: 3
    ] as [number, number][];
    expect(legendSpot(RECT, 2, crowd)).toEqual({ x: RECT.x + 8, y: 30 });
  });
});
