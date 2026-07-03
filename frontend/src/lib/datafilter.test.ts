import { describe, expect, it } from "vitest";

import { filteredOutRows, isActive, rowPasses, sanitizeFilter } from "./datafilter";
import type { DataStruct } from "./types";

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [1, 10],
    [2, 20],
    [1, 30],
    [2, 40],
  ],
  labels: ["g", "v"],
  units: ["", ""],
  metadata: {},
};

describe("isActive", () => {
  it("is true only for a constraining predicate", () => {
    expect(isActive({ col: 1, kind: "range", min: 5 })).toBe(true);
    expect(isActive({ col: 1, kind: "range", max: 5 })).toBe(true);
    expect(isActive({ col: 1, kind: "range" })).toBe(false); // open both ways
    expect(isActive({ col: 0, kind: "set", values: [1] })).toBe(true);
    expect(isActive({ col: 0, kind: "set", values: [] })).toBe(false);
    expect(isActive({ col: 0, kind: "set" })).toBe(false);
  });
});

describe("rowPasses", () => {
  it("ANDs active predicates across columns; non-finite fails", () => {
    const filter = [
      { col: 1, kind: "range" as const, min: 15 },
      { col: 0, kind: "set" as const, values: [1] },
    ];
    // row 2 = (g=1, v=30): passes both
    expect(rowPasses(filter, DATA, 2)).toBe(true);
    // row 0 = (g=1, v=10): fails the range
    expect(rowPasses(filter, DATA, 0)).toBe(false);
    // row 3 = (g=2, v=40): fails the set
    expect(rowPasses(filter, DATA, 3)).toBe(false);
  });

  it("passes everything for an absent or inactive filter", () => {
    expect(rowPasses(undefined, DATA, 0)).toBe(true);
    expect(rowPasses([{ col: 1, kind: "range" }], DATA, 0)).toBe(true);
  });
});

describe("filteredOutRows", () => {
  it("returns the indices that fail (range)", () => {
    const out = filteredOutRows([{ col: 1, kind: "range", min: 15 }], DATA);
    expect([...out].sort()).toEqual([0]);
  });

  it("returns the indices that fail (set)", () => {
    const out = filteredOutRows([{ col: 0, kind: "set", values: [1] }], DATA);
    expect([...out].sort()).toEqual([1, 3]);
  });

  it("combines predicates (AND) — a row fails if it fails any", () => {
    const out = filteredOutRows(
      [
        { col: 1, kind: "range", min: 15 },
        { col: 0, kind: "set", values: [1] },
      ],
      DATA,
    );
    expect([...out].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });

  it("is empty for an absent / fully-inactive filter", () => {
    expect(filteredOutRows(undefined, DATA).size).toBe(0);
    expect(filteredOutRows([{ col: 1, kind: "range" }], DATA).size).toBe(0);
  });
});

describe("sanitizeFilter", () => {
  it("keeps valid predicates and drops malformed / out-of-range ones", () => {
    const clean = sanitizeFilter(
      [
        { col: 1, kind: "range", min: 5, max: 50 },
        { col: 0, kind: "set", values: [1, 2] },
        { col: 9, kind: "range", min: 1 }, // col out of range (2 channels)
        { col: 0, kind: "bogus" }, // bad kind
        { col: 1, kind: "range" }, // inactive
        "nope",
      ],
      2,
    );
    expect(clean).toEqual([
      { col: 1, kind: "range", min: 5, max: 50 },
      { col: 0, kind: "set", values: [1, 2] },
    ]);
  });

  it("returns [] for a non-array", () => {
    expect(sanitizeFilter("x", 2)).toEqual([]);
    expect(sanitizeFilter(undefined, 2)).toEqual([]);
  });
});
