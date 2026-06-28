import { describe, expect, it } from "vitest";

import { buildErrorColumns } from "./errorbars";
import type { DataStruct } from "./types";

const ds: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 0.5, 100],
    [20, 0.6, 200],
    [30, -0.7, 300], // signed error → magnitude
  ],
  labels: ["M", "dM", "T"],
  units: ["emu", "emu", "K"],
  metadata: {},
};

describe("buildErrorColumns", () => {
  it("keys errors by display column (p+1) for channels with an err mapping", () => {
    // Plot M (ch 0) and T (ch 2); M's error is ch 1, T has none.
    const m = buildErrorColumns(ds, [0, 2], { 0: 1 });
    expect([...m.keys()]).toEqual([1]); // only the first plotted series (column 1)
    expect(m.get(1)).toEqual([0.5, 0.6, 0.7]); // abs of dM
  });

  it("respects plotted order when assigning columns", () => {
    // Plot T (ch 2) first, then M (ch 0). M's error (ch 1) lands on column 2.
    const m = buildErrorColumns(ds, [2, 0], { 0: 1 });
    expect([...m.keys()]).toEqual([2]);
    expect(m.get(2)).toEqual([0.5, 0.6, 0.7]);
  });

  it("returns an empty map when no channel has an error mapping", () => {
    expect(buildErrorColumns(ds, [0, 2], {}).size).toBe(0);
  });

  it("maps non-finite error values to null", () => {
    const withNaN: DataStruct = {
      ...ds,
      values: [
        [10, NaN, 100],
        [20, Infinity, 200],
        [30, 0.7, 300],
      ],
    };
    expect(buildErrorColumns(withNaN, [0], { 0: 1 }).get(1)).toEqual([null, null, 0.7]);
  });
});
