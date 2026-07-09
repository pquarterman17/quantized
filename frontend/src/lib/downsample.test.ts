import { describe, expect, it } from "vitest";

import { downsampleMinMax } from "./downsample";

describe("downsampleMinMax", () => {
  it("passes a short series (n <= buckets) through untouched", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 20, 5, 30, 15];
    const r = downsampleMinMax(xs, ys, xs.length, 360);
    expect(r.xs).toEqual(xs);
    expect(r.ys).toEqual(ys);
    expect(r.xMin).toBe(0);
    expect(r.xMax).toBe(4);
    expect(r.yMin).toBe(5);
    expect(r.yMax).toBe(30);
  });

  it("passes a series exactly at the bucket count through untouched", () => {
    const xs = [0, 1, 2];
    const ys = [1, 2, 3];
    const r = downsampleMinMax(xs, ys, xs.length, 3);
    expect(r.xs).toEqual(xs);
    expect(r.ys).toEqual(ys);
  });

  it("caps output at 2 points per bucket for a long series", () => {
    const n = 10_000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.sin(i * 0.01) * 100);
    const buckets = 360;
    const r = downsampleMinMax(xs, ys, n, buckets);
    expect(r.xs.length).toBeLessThanOrEqual(buckets * 2);
    expect(r.xs.length).toBeGreaterThan(buckets); // most buckets contribute 2 distinct points
  });

  it("preserves the envelope: a single-sample spike buried in a bucket survives", () => {
    // 10,000 flat-zero points with one large spike at index 5000, downsampled
    // to a handful of buckets. Plain every-Nth-point stride would very likely
    // step clean over a single-index spike; min/max-per-bucket never can,
    // since the spike's bucket picks it as that bucket's max.
    const n = 10_000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = new Array(n).fill(0);
    ys[5000] = 1_000_000;
    const r = downsampleMinMax(xs, ys, n, 100);
    expect(r.yMax).toBe(1_000_000);
    expect(r.ys).toContain(1_000_000);
  });

  it("never lets a plain stride sample erase a spike (regression check)", () => {
    // Sanity-check the premise the fix is built on: sampling every Nth point
    // (n/buckets stride) misses a spike planted off-stride, but the bucketed
    // min/max never does.
    const n = 3600;
    const buckets = 360;
    const stride = n / buckets; // 10
    const spikeIdx = 5; // off the stride grid (stride hits 0, 10, 20, ...)
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = new Array(n).fill(0);
    ys[spikeIdx] = 42;

    const strideSample = Array.from({ length: buckets }, (_, b) => ys[b * stride]);
    expect(strideSample).not.toContain(42); // the naive approach this fix avoids

    const r = downsampleMinMax(xs, ys, n, buckets);
    expect(r.ys).toContain(42);
  });

  it("selects min/max per bucket in original left-to-right index order", () => {
    // Bucket 0 spans indices 0..3: max (30) occurs before min (5) in index
    // order, so the emitted pair must preserve that order (max, then min) --
    // never re-sorted by value, or the path would zigzag backwards visually.
    const xs = [0, 1, 2, 3];
    const ys = [30, 20, 10, 5];
    const r = downsampleMinMax(xs, ys, xs.length, 1);
    expect(r.xs).toEqual([0, 3]);
    expect(r.ys).toEqual([30, 5]);
  });

  it("drops non-finite pairs and reports bounds over the finite subset only", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, NaN, 30, Infinity, 20];
    const r = downsampleMinMax(xs, ys, xs.length, 360); // short series -> passthrough branch
    expect(r.xs).toEqual([0, 2, 4]);
    expect(r.ys).toEqual([10, 30, 20]);
    expect(r.yMin).toBe(10);
    expect(r.yMax).toBe(30);
  });

  it("drops non-finite pairs in the bucketed branch too", () => {
    const n = 1000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => (i % 7 === 0 ? NaN : i));
    const r = downsampleMinMax(xs, ys, n, 50);
    expect(r.ys.every((y) => Number.isFinite(y))).toBe(true);
    expect(r.yMax).toBeLessThan(n); // never picked up a NaN as an extreme
  });

  it("returns empty output (bounds stay +/-Infinity) for an all-non-finite series", () => {
    const xs = [0, 1, 2];
    const ys = [NaN, NaN, NaN];
    const r = downsampleMinMax(xs, ys, xs.length, 1);
    expect(r.xs).toEqual([]);
    expect(r.ys).toEqual([]);
    expect(r.yMin).toBe(Infinity);
    expect(r.yMax).toBe(-Infinity);
  });

  it("handles n=0", () => {
    const r = downsampleMinMax([], [], 0, 360);
    expect(r.xs).toEqual([]);
    expect(r.ys).toEqual([]);
  });

  it("a bucket with no finite points contributes nothing (no gap-filling)", () => {
    const xs = [0, 1, 2, 3];
    const ys = [NaN, NaN, 5, 10];
    // 2 buckets: [0,1] all-NaN, [2,3] finite.
    const r = downsampleMinMax(xs, ys, xs.length, 2);
    expect(r.xs).toEqual([2, 3]);
    expect(r.ys).toEqual([5, 10]);
  });
});
