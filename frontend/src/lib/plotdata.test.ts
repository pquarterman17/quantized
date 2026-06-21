import { describe, expect, it } from "vitest";

import { buildColumns } from "./plotdata";
import { makeDemoDataset } from "./demo";
import type { DataStruct } from "./types";

describe("buildColumns", () => {
  it("packs x + each channel as aligned columns", () => {
    const ds: DataStruct = {
      time: [0, 1, 2],
      values: [
        [10, 100],
        [20, 200],
        [30, 300],
      ],
      labels: ["A", "B"],
      units: ["V", "A"],
      metadata: { x_column_name: "T", x_column_unit: "s" },
    };
    const p = buildColumns(ds);
    expect(p.data).toEqual([
      [0, 1, 2],
      [10, 20, 30],
      [100, 200, 300],
    ]);
    expect(p.series).toEqual([
      { label: "A", unit: "V" },
      { label: "B", unit: "A" },
    ]);
    expect(p.xLabel).toBe("T");
    expect(p.xUnit).toBe("s");
  });

  it("maps non-finite values to null", () => {
    const ds: DataStruct = {
      time: [0, NaN, 2],
      values: [[1], [2], [Infinity]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const p = buildColumns(ds);
    expect(p.data[0]).toEqual([0, null, 2]);
    expect(p.data[1]).toEqual([1, 2, null]);
  });

  it("handles the demo dataset", () => {
    const p = buildColumns(makeDemoDataset());
    expect(p.data).toHaveLength(2); // x + 1 channel
    expect(p.data[0]).toHaveLength(201);
    expect(p.series[0].label).toBe("Moment");
  });
});
