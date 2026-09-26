import { describe, expect, it } from "vitest";

import { categoricalLevels, categoryLevels } from "./categorical";
import { is2DMap } from "./mapdata";
import { makeFirstRunExample } from "./firstRunExamples";

describe("first-run examples", () => {
  it("makes finite rectangular data for every example", () => {
    for (const kind of ["line", "grouped", "map"] as const) {
      const { data } = makeFirstRunExample(kind);
      expect(data.time.length).toBeGreaterThan(10);
      expect(data.values).toHaveLength(data.time.length);
      expect(data.values.every((row) => row.length === data.labels.length)).toBe(true);
      expect(data.values.flat().every(Number.isFinite)).toBe(true);
      expect(data.units).toHaveLength(data.labels.length);
    }
  });

  it("makes a categorical grouped example with human-readable levels", () => {
    const example = makeFirstRunExample("grouped");
    expect(example.groupKey).toBe(1);
    expect(categoryLevels(example.data, 1)).toEqual([0, 1, 2]);
    expect(categoricalLevels(example.data, 1)).toEqual(["Lot A", "Lot B", "Lot C"]);
    expect(new Set(example.data.values.map((row) => row[1]))).toEqual(new Set([0, 1, 2]));
  });

  it("makes a map that follows the ordinary 2-D capability contract", () => {
    const example = makeFirstRunExample("map");
    expect(is2DMap(example.data)).toBe(true);
    expect(example.data.labels).toEqual(["Qx", "Qz", "Intensity"]);
  });

  it("returns new arrays so examples never share mutable user state", () => {
    const first = makeFirstRunExample("line");
    const second = makeFirstRunExample("line");
    first.data.values[0][0] = 999;
    expect(second.data.values[0][0]).not.toBe(999);
  });
});
