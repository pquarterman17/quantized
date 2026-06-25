import { describe, expect, it, vi } from "vitest";

import { buildMapColumns, fetchMap, regridNearest } from "./mapdata";
import type { DataStruct } from "./types";

vi.mock("./api", () => ({
  mapSeries: vi.fn(() => Promise.reject(new Error("offline"))),
}));

describe("regridNearest", () => {
  it("bins corner points onto their own cells (row-major [ny][nx])", () => {
    const x = [0, 1, 0, 1];
    const y = [0, 0, 1, 1];
    const z = [1, 2, 3, 4];
    const { xAxis, yAxis, zGrid } = regridNearest(x, y, z, 2, 2);
    expect(xAxis).toEqual([0, 1]);
    expect(yAxis).toEqual([0, 1]);
    // row j=0 is y=0 (z 1,2); row j=1 is y=1 (z 3,4).
    expect(zGrid).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("leaves cells with no nearest point as null", () => {
    // One point in a 3×3 grid -> exactly one filled cell, the rest null.
    const { zGrid } = regridNearest([0.5], [0.5], [9], 3, 3);
    const filled = zGrid.flat().filter((v) => v != null);
    expect(filled).toEqual([9]);
  });

  it("averages multiple points landing in the same cell", () => {
    // Two points near the same corner of a 2×2 grid -> mean of their z.
    const { zGrid } = regridNearest([0, 0.01, 1], [0, 0.01, 1], [10, 20, 5], 2, 2);
    expect(zGrid[0][0]).toBe(15); // mean(10, 20)
    expect(zGrid[1][1]).toBe(5);
  });

  it("returns a 1×1 null grid when all input is non-finite", () => {
    expect(regridNearest([NaN], [NaN], [NaN], 4, 4)).toEqual({
      xAxis: [0],
      yAxis: [0],
      zGrid: [[null]],
    });
  });
});

function _ds(): DataStruct {
  return {
    time: [0, 1, 2, 3],
    values: [
      [0, 0, 1],
      [1, 0, 2],
      [0, 1, 3],
      [1, 1, 4],
    ],
    labels: ["Qx", "Qz", "I"],
    units: ["1/A", "1/A", "cps"],
    metadata: {},
  };
}

describe("buildMapColumns", () => {
  it("carries the chosen channels' labels/units and z range", () => {
    const p = buildMapColumns(_ds(), 0, 1, 2, 2, 2);
    expect(p.xLabel).toBe("Qx");
    expect(p.yLabel).toBe("Qz");
    expect(p.zLabel).toBe("I");
    expect(p.zUnit).toBe("cps");
    expect(p.zMin).toBe(1);
    expect(p.zMax).toBe(4);
  });

  it("resolves channels by label too", () => {
    const p = buildMapColumns(_ds(), "Qx", "Qz", "I", 2, 2);
    expect(p.zGrid).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("fetchMap", () => {
  it("falls back to the client regrid when the backend is unavailable", async () => {
    const p = await fetchMap(_ds(), 0, 1, 2, { nx: 2, ny: 2 });
    expect(p.zGrid).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(p.zMin).toBe(1);
    expect(p.zMax).toBe(4);
  });
});
