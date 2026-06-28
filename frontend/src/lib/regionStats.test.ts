import { describe, expect, it } from "vitest";

import { computeRegionStats } from "./regionStats";

const data: (number | null)[][] = [
  [0, 1, 2, 3, 4], // x
  [10, 20, 30, 40, 50], // A
  [5, null, 15, null, 25], // B (with gaps)
];
const labels = ["A", "B"];

describe("computeRegionStats", () => {
  it("summarizes each series over the inclusive x-band", () => {
    const r = computeRegionStats(data, labels, 1, 3)!;
    expect(r.xMin).toBe(1);
    expect(r.xMax).toBe(3);
    const a = r.series[0];
    expect(a.label).toBe("A");
    expect(a.n).toBe(3); // x in {1,2,3} -> 20,30,40
    expect(a.mean).toBeCloseTo(30);
    expect(a.median).toBe(30);
    expect(a.min).toBe(20);
    expect(a.max).toBe(40);
    expect(a.std).toBeCloseTo(10); // sample std (ddof=1) of [20,30,40]
  });

  it("handles a reversed (drag-right-to-left) band the same way", () => {
    const r = computeRegionStats(data, labels, 3, 1)!;
    expect([r.xMin, r.xMax]).toEqual([1, 3]);
    expect(r.series[0].n).toBe(3);
  });

  it("skips null / non-finite points", () => {
    const b = computeRegionStats(data, labels, 0, 4)!.series[1];
    expect(b.n).toBe(3); // 5,15,25 — the two nulls dropped
    expect(b.mean).toBeCloseTo(15);
  });

  it("returns null for a zero-width band or an empty selection", () => {
    expect(computeRegionStats(data, labels, 2, 2)).toBeNull();
    expect(computeRegionStats(data, labels, 10, 20)).toBeNull();
  });

  it("respects the visibility mask (legend-hidden series excluded)", () => {
    const r = computeRegionStats(data, labels, 0, 4, [true, false])!;
    expect(r.series.map((s) => s.label)).toEqual(["A"]);
  });

  it("reports std = NaN for a single in-band point", () => {
    const r = computeRegionStats(data, labels, 0, 0.5)!; // only x=0
    expect(r.series[0].n).toBe(1);
    expect(Number.isNaN(r.series[0].std)).toBe(true);
  });
});
