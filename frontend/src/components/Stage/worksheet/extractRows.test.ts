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

// BUG-006's deferred reproduction test, added once the fix (lib/datasetsplit.ts's
// sliceDataStruct -> lib/rowSidecars.sliceRowSidecars) had shipped across every
// site: the original symptom, end to end, at the layer the user experiences.
// Filtering to a row subset and pressing Extract used to hand back a child
// whose numeric rows were the right ones but whose `text_columns` sidecar was
// still the PARENT's full, unsliced lists — every text cell read against the
// wrong row. `planExtract` is exactly what `useWorksheetView`'s `extractSubset`
// calls for the Extract button, so this exercises the real Extract path, not
// just the lower-level `sliceDataStruct` unit already covered in
// `lib/datasetsplit.test.ts`.
describe("planExtract — a filtered row subset's text cells line up with THEIR OWN rows on Extract (BUG-006)", () => {
  it("extracts a non-contiguous filtered subset with every text cell attributed to its own row, not the parent's position", () => {
    // Six source rows; row i's value is i*10 and its text cell names row i, so
    // any misattribution shows up as the two disagreeing.
    const withTextColumns: DataStruct = {
      time: [0, 1, 2, 3, 4, 5],
      values: [[0], [10], [20], [30], [40], [50]],
      labels: ["Signal"],
      units: ["u"],
      metadata: { text_columns: { SampleID: ["row0", "row1", "row2", "row3", "row4", "row5"] } },
    };

    // Simulates the Data Filter narrowing the worksheet to a non-contiguous
    // subset (e.g. "Signal >= 20 or row 0"), then the user presses Extract.
    const filteredRows = [0, 2, 4, 5];
    const plan = planExtract(withTextColumns, filteredRows)!;
    expect(plan.extracted).toBe(4);
    expect(plan.skipped).toBe(0);

    const sampleIds = plan.data.metadata["text_columns"] as { SampleID: string[] };
    expect(sampleIds.SampleID).toHaveLength(4);

    // The real assertion: for every child row, its OWN text cell names the
    // SAME source row its OWN numeric value came from — a sliced sidecar (this
    // fix), not the parent's positionally-read one (the original bug, which
    // would have left `SampleID` as the full 6-entry parent array and shown
    // child row 1 — value 20, source row 2 — beside "row1").
    plan.data.values.forEach((row, childIndex) => {
      const sourceRowFromValue = row[0] / 10;
      const sourceRowFromText = Number(sampleIds.SampleID[childIndex].replace("row", ""));
      expect(sourceRowFromText).toBe(sourceRowFromValue);
    });
    expect(sampleIds.SampleID).toEqual(["row0", "row2", "row4", "row5"]);
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
