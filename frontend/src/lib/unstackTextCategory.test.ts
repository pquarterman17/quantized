// Live check (worksheet ops): Unstack offered only numeric columns as the
// category, so a long table's text column (Sample = S0/S1/S2) could not be
// pivoted on, and the default category was the first numeric column — a
// 20-row sheet became 20 one-cell "Category 0.327…" columns.

import { describe, expect, it } from "vitest";

import { defaultCategory, formToRun, seedForm } from "../components/workshops/transformPreview/transformForm";
import { analyzeUnstack } from "./transformWarnings";
import type { DataStruct } from "./types";
import { unstackRowCount, unstackWorksheet } from "./worksheetTransforms";

const long: DataStruct = {
  time: [10, 10, 20, 20, 30],
  values: [[1.5], [2.5], [3.5], [4.5], [5.5]],
  labels: ["Signal"],
  units: ["mV"],
  metadata: { text_columns: { Sample: ["S0", "S1", "S0", "S1", " "] } },
};

describe("unstack on a text category", () => {
  it("pivots on the text, names each new column by it, and drops a blank category row", () => {
    const out = unstackWorksheet(long, -1, "Sample", 0);
    expect(out.labels).toEqual(["S0", "S1"]);
    expect(out.time).toEqual([10, 20]);
    expect(out.values).toEqual([[1.5, 2.5], [3.5, 4.5]]);
    expect(out.units).toEqual(["mV", "mV"]);
    expect(unstackRowCount(long, -1, "Sample", 0)).toBe(2);
    expect(analyzeUnstack(long, -1, "Sample", 0, "mean").map((w) => w.code)).toEqual(["rows-dropped"]);
  });

  it("a numeric category keeps its 'Category <value>' names", () => {
    const numeric: DataStruct = { ...long, values: long.values.map((r, i) => [r[0], i % 2]), labels: ["Signal", "Run"], units: ["mV", ""] };
    expect(unstackWorksheet(numeric, -1, 1, 0).labels).toEqual(["Category 0", "Category 1"]);
  });

  it("the form defaults to the text column, offers it, and records it by name", () => {
    expect(defaultCategory(long)).toBe("t:Sample");
    const form = seedForm("unstack", ["l"], [{ id: "l", name: "long", data: long }]);
    expect(form.category).toBe("t:Sample");
    expect(form.value).toBe(0);
    const run = formToRun(form, [{ id: "l", name: "long", data: long }]);
    expect(typeof run !== "string" && run.params).toMatchObject({ op: "unstack", category: "Sample", value: 0 });
  });

  it("a unique-per-row text column (a timestamp) is not the default; the low-cardinality one is", () => {
    const withDate: DataStruct = {
      ...long,
      metadata: { text_columns: { Date: ["d1", "d2", "d3", "d4", "d5"], Sample: ["S0", "S1", "S0", "S1", "S0"] } },
    };
    expect(defaultCategory(withDate)).toBe("t:Sample");
  });

  it("without a text column, the default is the channel with the fewest distinct values, not the first", () => {
    const wide: DataStruct = {
      time: [1, 2, 3, 4, 5, 6],
      values: [[0.11, 7, 1], [0.27, 7, 2], [0.38, 8, 3], [0.49, 8, 4], [0.51, 9, 5], [0.66, 9, 6]],
      labels: ["Signal", "Setpoint", "Index"],
      units: ["", "", ""],
      metadata: {},
    };
    expect(defaultCategory(wide)).toBe("1");
  });
});
