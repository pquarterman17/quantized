import { describe, expect, it } from "vitest";

import { DEFAULT_SIZE_RANGE, buildSizeKey, sizeDiameter, sizeLegendEntries } from "./sizescatter";
import type { DataStruct } from "./types";

const ds = (): DataStruct => ({
  time: [0, 1, 2, 3],
  values: [[1, 0], [2, 1], [3, 2], [4, NaN]],
  labels: ["y", "mass"],
  units: ["", "g"],
  metadata: {},
});

describe("sizeDiameter (N5 size by column)", () => {
  it("maps the channel's finite range linearly onto the px range", () => {
    const key = buildSizeKey(ds(), 1, [4, 12])!;
    expect(key).toMatchObject({ channel: 1, lo: 0, hi: 2, minPx: 4, maxPx: 12 });
    expect(sizeDiameter(key, 0)).toBe(4);
    expect(sizeDiameter(key, 1)).toBe(8);
    expect(sizeDiameter(key, 2)).toBe(12);
  });

  it("a non-finite value draws no point; a constant column reads mid-range", () => {
    const key = buildSizeKey(ds(), 1)!;
    expect(sizeDiameter(key, NaN)).toBeNull();
    expect(sizeDiameter(key, null)).toBeNull();
    const flat = { channel: 0, lo: 2, hi: 2, minPx: 3, maxPx: 14 };
    expect(sizeDiameter(flat, 2)).toBe(8.5); // same rule as the export
  });

  it("defaults the range and rejects a bad one / an all-empty channel", () => {
    expect(DEFAULT_SIZE_RANGE).toEqual([3, 14]);
    expect(buildSizeKey(ds(), 1)).toMatchObject({ minPx: 3, maxPx: 14 });
    expect(buildSizeKey(ds(), 1, [0, 5])).toMatchObject({ minPx: 3, maxPx: 14 });
    const empty = { ...ds(), values: [[1, NaN], [2, NaN]] };
    expect(buildSizeKey(empty, 1)).toBeNull();
  });

  it("legend entries name the channel and span min/mid/max", () => {
    const key = buildSizeKey(ds(), 1, [4, 12])!;
    const e = sizeLegendEntries(ds(), [{ size: key }])[0];
    expect(e.label).toBe("mass (g)");
    expect(e.marks.map((m) => [m.value, m.px])).toEqual([[0, 4], [1, 8], [2, 12]]);
  });
});
