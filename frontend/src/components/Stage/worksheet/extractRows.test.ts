// Extract's row-index domain. The interesting case is the one that used to
// produce a corrupt child dataset in silence: an Origin sheet whose inline-TEXT
// columns are longer than its numeric columns, so the worksheet's row indices
// run past `values`.

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { describeExtract, planExtract } from "./extractRows";

const numeric: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 0],
    [20, 1],
    [30, 0],
  ],
  labels: ["A", "Phase"],
  units: ["u", ""],
  metadata: {},
  cat_levels: { 1: ["alpha", "beta"] },
};

describe("planExtract", () => {
  it("slices the requested rows and keeps the level table (a row slice cannot change column layout)", () => {
    const plan = planExtract(numeric, [0, 2])!;
    expect(plan.extracted).toBe(2);
    expect(plan.skipped).toBe(0);
    expect(plan.data.time).toEqual([1, 3]);
    expect(plan.data.values).toEqual([
      [10, 0],
      [30, 0],
    ]);
    expect(plan.data.cat_levels).toEqual({ 1: ["alpha", "beta"] });
  });

  it("drops row indices past `values` instead of storing an undefined row", () => {
    // Rows 3 and 4 exist only in the sheet's text columns (see the module doc);
    // the old hand-built literal wrote `values[3]` === undefined into the child.
    const plan = planExtract(numeric, [1, 3, 4])!;
    expect(plan.extracted).toBe(1);
    expect(plan.skipped).toBe(2);
    expect(plan.data.values).toEqual([[20, 1]]);
    // Nothing undefined reached the child — the whole point.
    expect(plan.data.values.every((row) => row.every((v) => typeof v === "number"))).toBe(true);
    expect(plan.data.time.every((t) => typeof t === "number")).toBe(true);
  });

  it("refuses (null) when every requested row is text-only — a DataStruct cannot hold them", () => {
    expect(planExtract(numeric, [5, 6])).toBeNull();
    expect(planExtract(numeric, [])).toBeNull();
  });

  it("handles a text-only book (time.length === 0, text columns ARE the grid)", () => {
    const textOnly: DataStruct = { time: [], values: [], labels: [], units: [], metadata: {} };
    expect(planExtract(textOnly, [0, 1, 2])).toBeNull();
  });
});

describe("describeExtract", () => {
  it("names the rows left behind rather than silently reporting a smaller total", () => {
    expect(describeExtract({ data: numeric, extracted: 1, skipped: 2 }, 5)).toBe(
      "extracted 1 of 5 rows (2 text-only rows have no numeric data)",
    );
  });

  it("says nothing extra when nothing was left behind", () => {
    expect(describeExtract({ data: numeric, extracted: 2, skipped: 0 }, 3)).toBe("extracted 2 of 3 rows");
  });

  it("singularizes one skipped row", () => {
    expect(describeExtract({ data: numeric, extracted: 2, skipped: 1 }, 3)).toContain("1 text-only row have");
  });

  it("describes a refusal too, so the caller has one thing to say either way", () => {
    expect(describeExtract(null, 3)).toBe("nothing to extract — the selected rows carry no numeric data");
  });
});
