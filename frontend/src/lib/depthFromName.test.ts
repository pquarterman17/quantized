import { describe, expect, it } from "vitest";

import { depthFromName } from "./depthFromName";

describe("depthFromName", () => {
  it.each([
    ["sample-50K", 50], // hyphen after a letter: a separator, not a minus
    ["sample-100K", 100],
    ["S1_10K", 10], // the unit-attached number, not the leading 1
    ["S1_50K", 50],
    ["S1 300 K", 300],
    ["2026-11-15_300K", 300], // a date prefix is not the depth
    ["scan 300K.csv", 300],
    ["MvsH 5 K 2 T", 2], // the last unit-attached number
    ["T=-5 K", -5], // a real sign (after '=')
    ["-20C", -20],
    ["run7", 7], // no unit: the last number
    ["10-20K", 20],
    ["1.5e2 Oe", 150],
  ])("%s -> %s", (name, want) => {
    expect(depthFromName(name)).toBe(want);
  });

  it("is null when there is no number", () => {
    expect(depthFromName("blank")).toBeNull();
    expect(depthFromName("")).toBeNull();
  });
});
