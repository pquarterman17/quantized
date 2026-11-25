import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildRequest, emptyForm } from "./mapOpsForm";
import { boundText, gridAxis, nearestCell, snapDrawnRegion } from "./drawnCrop";

// 5 x 4 grid: Qx 0, .5, 1, 1.5, 2 and Qz 10, 20, 30, 40.
const data = (): DataStruct => {
  const values: number[][] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) values.push([i * 0.5, 10 * (j + 1), i + j]);
  return { time: values.map((r) => r[0]!), values, labels: ["Qx", "Qz", "Intensity"], units: ["", "", ""], metadata: { is2D: true, map_shape: [5, 4] } };
};
const box = (x0: number, x1: number, y0: number, y1: number) => ({ space: "q" as const, x0, x1, y0, y1 });

describe("drawn-region crop", () => {
  it("builds the grid axes and snaps to the nearest cell (ties lower)", () => {
    expect(gridAxis(data(), 0)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(nearestCell([0, 1, 2], 0.4)).toBe(0);
    expect(nearestCell([0, 1, 2], 0.5)).toBe(0);
    expect(nearestCell([0, 1, 2], 1.6)).toBe(2);
    expect(nearestCell([0, 1, 2], -5)).toBe(0);
  });

  it("maps the drawn rectangle to the correct cell bounds, whichever corner was dragged first", () => {
    const r = snapDrawnRegion(data(), box(1.7, 0.4, 33, 12));
    expect(r.crop).toMatchObject({ cols: [0, 1, 2], xmin: 0.5, xmax: 1.5, ymin: 10, ymax: 30 });
  });

  it("gives the same crop request as typing the snapped bounds", () => {
    const r = snapDrawnRegion(data(), box(0.4, 1.7, 12, 33));
    const c = r.crop!;
    const drawn = buildRequest({ ...emptyForm(), xmin: boundText(c.xmin), xmax: boundText(c.xmax), ymin: boundText(c.ymin), ymax: boundText(c.ymax) });
    const typed = buildRequest({ ...emptyForm(), xmin: "0.5", xmax: "1.5", ymin: "10", ymax: "30" });
    expect(drawn).toEqual(typed);
  });

  it("refuses with a reason: no box, outside, single cell, missing axes", () => {
    expect(snapDrawnRegion(data(), null).error).toMatch(/Draw a box/);
    expect(snapDrawnRegion(data(), box(5, 6, 10, 40)).error).toMatch(/outside/);
    expect(snapDrawnRegion(data(), box(0.9, 1.1, 10, 40)).error).toMatch(/single cell/);
    expect(snapDrawnRegion(data(), { ...box(0, 1, 10, 20), space: "angular" }).error).toMatch(/no such axes/);
  });
});
