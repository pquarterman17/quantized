// Wide plots (live audit: 200k rows x 49 channels drew ~5M points per frame and
// blocked the main thread for seconds per zoom step). The load-invariant, not a
// wall-clock bound: the decimated row count is bounded independent of the
// series count, and every series still keeps its own per-bucket extremes.
import { describe, expect, it } from "vitest";

import { bucketsForWidth } from "./plotDecimate";
import { GAP_ROW_CAP, buildDecimatedData, cappedBuckets } from "./plotDecimateRows";

const N = 20_000;
const WIDTH = 1440;

/** Deterministic noisy columns, each with a spike at a row only it owns. */
function wide(nSeries: number): (number | null)[][] {
  const x = Array.from({ length: N }, (_, i) => i);
  const cols = Array.from({ length: nSeries }, (_, s) =>
    Array.from({ length: N }, (_, i) => Math.sin(i * (0.013 + s * 0.0007)) + 0.1 * Math.sin(i * 1.7 + s)),
  );
  for (let s = 0; s < nSeries; s++) cols[s][(137 * (s + 1)) % N] = 100 + s; // series s' unique peak
  return [x, ...cols];
}

describe("cappedBuckets", () => {
  it("leaves a narrow plot untouched and scales buckets down for a wide one", () => {
    expect(cappedBuckets(1440, 3)).toBe(1440);
    expect(2 * cappedBuckets(1440, 49) * 49).toBeLessThanOrEqual(GAP_ROW_CAP);
  });
});

describe("buildDecimatedData on a wide plot", () => {
  it("bounds the row count independent of the series count", () => {
    for (const n of [3, 12, 49, 200]) expect(buildDecimatedData(wide(n), 0, N, WIDTH)[0].length).toBeLessThanOrEqual(GAP_ROW_CAP);
  });

  it("keeps every series' own extremes (its unique spike and its minimum) as real, row-aligned samples", () => {
    const nSeries = 49;
    const data = wide(nSeries);
    const out = buildDecimatedData(data, 0, N, WIDTH);
    expect(out.length).toBe(nSeries + 1);
    for (let s = 1; s <= nSeries; s++) {
      const full = data[s] as number[];
      const col = out[s] as number[];
      expect(Math.max(...col)).toBe(Math.max(...full));
      expect(Math.min(...col)).toBe(Math.min(...full));
      col.forEach((v, k) => expect(full[out[0][k] as number]).toBe(v));
    }
  });

  it("keeps per-bucket extremes of every series at the capped bucket count", () => {
    const nSeries = 30;
    const data = wide(nSeries);
    const out = buildDecimatedData(data, 0, N, WIDTH);
    const b = cappedBuckets(bucketsForWidth(WIDTH), nSeries);
    const xs = out[0] as number[];
    for (const s of [1, 15, 30]) {
      const col = data[s] as number[];
      for (let k = 0; k < b; k += 7) {
        const [start, end] = [Math.floor((k * N) / b), Math.floor(((k + 1) * N) / b)];
        const seg = col.slice(start, end);
        const kept = new Set<number>();
        xs.forEach((x, r) => x >= start && x < end && kept.add(out[s][r] as number));
        expect(kept.has(Math.max(...seg))).toBe(true);
        expect(kept.has(Math.min(...seg))).toBe(true);
      }
    }
  });

  it("a plot under the cap keeps the full bucket count", () => {
    expect(buildDecimatedData(wide(3), 0, N, WIDTH)[0].length).toBeGreaterThan(2 * 1000);
  });

  it("zooming in re-resolves toward every row", () => {
    expect(buildDecimatedData(wide(49), 1000, 1100, WIDTH)[0].length).toBeGreaterThanOrEqual(100);
  });
});
