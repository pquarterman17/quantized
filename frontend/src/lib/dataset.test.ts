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
