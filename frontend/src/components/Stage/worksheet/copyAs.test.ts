// "Copy as displayed": each column's display format, level names and date
// formatting are applied, a missing cell is an empty field, and the header is
// "Name (unit)". The default copy (full precision) is a different function.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { displayedBlock } from "./copyAs";

function ds(over: Partial<Dataset> = {}, meta: Record<string, unknown> = {}): Dataset {
  return {
    id: "d1",
    name: "s",
    data: {
      time: [1.23456789, 2.5, 3],
      values: [[0.000123456, 10], [NaN, 20], [0.5, 30]],
      labels: ["M", "T"],
      units: ["emu", "K"],
      metadata: meta,
    },
    ...over,
  };
}

describe("displayedBlock", () => {
  it("applies each column's display format; the other columns keep the grid's own precision", () => {
    const d = ds({ columnProps: { 0: { format: { kind: "decimal", digits: 2 } }, [-1]: { format: { kind: "sig", digits: 3 } } } });
    const { grid } = displayedBlock(d, [0, 1, 2], [-1, 0, 1]);
    expect(grid.map((r) => r[0])).toEqual(["1.23", "2.50", "3.00"]); // X: 3 significant digits
    expect(grid.map((r) => r[1])).toEqual(["0.00", "", "0.50"]); // M: 2 decimals; NaN is empty
    expect(grid[0][2]).toBe("10.0000"); // T: the grid's automatic fixed format
  });

  it("full precision is NOT what it writes", () => {
    const d = ds({ columnProps: { 0: { format: { kind: "decimal", digits: 3 } } } });
    expect(displayedBlock(d, [0], [0]).grid[0][0]).toBe("0.000");
    expect(String(d.data.values[0][0])).toBe("0.000123456");
  });

  it("headers carry the unit, X included; a unitless column is bare", () => {
    const d = ds({}, { x_column_long: "Time", x_column_unit: "s" });
    d.data.units[1] = "";
    expect(displayedBlock(d, [0], [-1, 0, 1]).headers).toEqual(["Time (s)", "M (emu)", "T"]);
  });

  it("writes level names for a categorical column and dates for a date X", () => {
    const d = ds();
    d.data.cat_levels = { 1: ["lo", "mid", "hi"] };
    d.data.values = [[1, 0], [2, 2], [3, 5]];
    const { grid } = displayedBlock(d, [0, 1, 2], [1]);
    expect(grid.map((r) => r[0])).toEqual(["lo", "hi", "5"]); // code 5 has no level: the number, as Copy does
    const dated = ds({}, { time_is_datetime: true });
    dated.data.time = [1_700_000_000, 1_700_000_060, 0];
    expect(displayedBlock(dated, [0, 1], [-1]).grid).toEqual([["2023-11-14 22:13:20"], ["2023-11-14 22:14:20"]]);
  });

  it("follows the row order it is given and an empty selection is empty", () => {
    const d = ds();
    expect(displayedBlock(d, [2, 0], [1]).grid).toEqual([["30.0000"], ["10.0000"]]);
    expect(displayedBlock(d, [], [0]).grid).toEqual([]);
  });
});
