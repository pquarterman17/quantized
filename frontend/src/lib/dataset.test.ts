import { describe, expect, it } from "vitest";

import { cloneDataStruct } from "./dataset";
import type { DataStruct } from "./types";

const src: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
  ],
  labels: ["A", "B"],
  units: ["V", "A"],
  metadata: { source: "test" },
};

describe("cloneDataStruct", () => {
  it("produces an equal-but-independent copy", () => {
    const copy = cloneDataStruct(src);
    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
  });

  it("does not alias the source's arrays (deep copy)", () => {
    const copy = cloneDataStruct(src);
    copy.time[0] = 999;
    copy.values[0][0] = 999;
    copy.labels[0] = "Z";
    (copy.metadata as Record<string, unknown>).source = "changed";
    expect(src.time[0]).toBe(0);
    expect(src.values[0][0]).toBe(10);
    expect(src.labels[0]).toBe("A");
    expect(src.metadata.source).toBe("test");
  });

  it("copies each value row independently", () => {
    const copy = cloneDataStruct(src);
    expect(copy.values[1]).not.toBe(src.values[1]);
    expect(copy.values[1]).toEqual([20, 200]);
  });
});

// The allowlist-copy bug (Group J audit): `cloneDataStruct` named the five
// required fields and silently dropped every optional one, so `duplicateDataset`
// and `freezeCopy` de-categorized a dataset and stripped an Origin import's
// decode products. These assert the SPREAD contract — "a new field is carried by
// default" — not just the one field that was noticed.
describe("cloneDataStruct — optional fields survive the copy", () => {
  const categorical: DataStruct = {
    ...src,
    values: [
      [10, 0],
      [20, 1],
      [30, 0],
    ],
    cat_levels: { 1: ["Pass", "Fail"] },
  };

  it("carries cat_levels forward — a duplicated categorical dataset stays categorical", () => {
    const copy = cloneDataStruct(categorical);
    expect(copy.cat_levels).toEqual({ 1: ["Pass", "Fail"] });
  });

  it("deep-copies each level array, so extending a level on the copy cannot reach the source", () => {
    const copy = cloneDataStruct(categorical);
    // What store/cellEdit.ts's "+ Add new level" does, applied to the copy.
    copy.cat_levels![1].push("Marginal");
    expect(categorical.cat_levels![1]).toEqual(["Pass", "Fail"]);
  });

  it("omits cat_levels entirely for a plain numeric dataset (byte-identical to before the field existed)", () => {
    const copy = cloneDataStruct(src);
    expect("cat_levels" in copy).toBe(false);
  });

  it("carries EVERY other optional field — the spread contract, not a per-field allowlist", () => {
    // Deliberately includes a field this module has no knowledge of: the point
    // is that an unknown key survives, which is what makes the next added
    // DataStruct field safe by default.
    const rich = {
      ...src,
      books: [{ id: "bk1", name: "Book1" }],
      book_source: { kind: "path", path: "/x/p.opju" },
      figures: [{ id: "fig1" }],
      origin_fidelity: { version: 1, figures: {} },
      some_future_field: { anything: true },
    } as unknown as DataStruct;
    const copy = cloneDataStruct(rich) as unknown as Record<string, unknown>;
    for (const key of ["books", "book_source", "figures", "origin_fidelity", "some_future_field"]) {
      expect(copy[key]).toEqual((rich as unknown as Record<string, unknown>)[key]);
    }
  });
});
