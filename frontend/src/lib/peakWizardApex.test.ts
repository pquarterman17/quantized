import { describe, expect, it } from "vitest";

import { baselineValueAt, plotApexY } from "./peakWizardApex";

/** Brute-force reference identical to the ORIGINAL implementation's
 *  semantics (strict `d < bestDist`, so the first — smallest-index —
 *  minimum wins on a tie). Used to fuzz-check the binary-search version
 *  against ground truth rather than trusting hand-picked cases alone. */
function nearestIndexLinear(x: readonly number[], target: number): number {
  let nearest = 0;
  let bestDist = Infinity;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - target);
    if (d < bestDist) {
      bestDist = d;
      nearest = i;
    }
  }
  return nearest;
}

function baselineValueAtLinear(
  center: number,
  x: readonly number[],
  baseline: readonly (number | null)[] | null,
): number {
  if (!baseline || x.length === 0) return 0;
  const nearest = nearestIndexLinear(x, center);
  const v = baseline[nearest];
  return v != null && Number.isFinite(v) ? v : 0;
}

describe("baselineValueAt — P5 review finding, round 6: binary search over ascending segment.x", () => {
  it("returns 0 when baseline is null", () => {
    expect(baselineValueAt(5, [1, 2, 3], null)).toBe(0);
  });

  it("returns 0 when x is empty", () => {
    expect(baselineValueAt(5, [], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for a non-finite baseline value at the nearest sample", () => {
    expect(baselineValueAt(2, [1, 2, 3], [1, NaN, 3])).toBe(0);
    expect(baselineValueAt(2, [1, 2, 3], [1, null, 3])).toBe(0);
  });

  it("finds the exact match", () => {
    expect(baselineValueAt(2, [1, 2, 3], [10, 20, 30])).toBe(20);
  });

  it("finds the nearer neighbour on either side", () => {
    const x = [0, 10, 20, 30, 40];
    const b = [0, 100, 200, 300, 400];
    expect(baselineValueAt(24, x, b)).toBe(200); // nearer to 20 than 30
    expect(baselineValueAt(26, x, b)).toBe(300); // nearer to 30 than 20
  });

  it("clamps to the first/last sample for out-of-range targets", () => {
    const x = [5, 10, 15];
    const b = [50, 100, 150];
    expect(baselineValueAt(-100, x, b)).toBe(50);
    expect(baselineValueAt(1000, x, b)).toBe(150);
  });

  it("a single-sample x always resolves to that sample", () => {
    expect(baselineValueAt(999, [42], [7])).toBe(7);
  });

  it("on an exact distance tie, prefers the SMALLER (earlier) index — matches the old linear scan's strict tie-break", () => {
    const x = [0, 10]; // target 5 is equidistant from both
    const b = [111, 222];
    expect(baselineValueAt(5, x, b)).toBe(111); // index 0, not 1
  });

  it("handles duplicate x values by preferring the first (leftmost) occurrence", () => {
    const x = [1, 5, 5, 5, 9];
    const b = [10, 20, 30, 40, 50];
    expect(baselineValueAt(5, x, b)).toBe(20); // first index where x===5
  });

  it("fuzz: agrees with the brute-force linear scan across random ascending arrays and targets", () => {
    let seed = 12345;
    const rand = (): number => {
      // Deterministic LCG — no external dependency, reproducible failures.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 50);
      const x: number[] = [];
      let cur = -50 + rand() * 20;
      for (let i = 0; i < n; i++) {
        x.push(cur);
        cur += rand() * 5; // strictly non-decreasing, occasional duplicates possible when rand()~0
      }
      const baseline = x.map((_, i) => i * 1.5);
      for (let q = 0; q < 10; q++) {
        const target = -60 + rand() * 80;
        const expected = baselineValueAtLinear(target, x, baseline);
        const actual = baselineValueAt(target, x, baseline);
        expect(actual).toBe(expected);
      }
    }
  });

  it("PERFORMANCE at 1M rows: binary search resolves 2000 lookups in well under the old linear-scan budget", () => {
    const n = 1_000_000;
    const x = new Array<number>(n);
    for (let i = 0; i < n; i++) x[i] = i;
    const baseline = new Array<number>(n);
    for (let i = 0; i < n; i++) baseline[i] = i * 2;

    const nLookups = 2000; // ~representative of a large "include toggle" candidate set
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < nLookups; i++) {
      const target = (i / nLookups) * n;
      acc += baselineValueAt(target, x, baseline);
    }
    const elapsedMs = performance.now() - t0;
    expect(acc).toBeGreaterThan(0); // keep the loop from being optimized away / sanity check
    // A linear scan at this scale measured ~0.58-1.0 ms/peak (round 4, at
    // 200k rows — proportionally ~5x worse at 1M) — i.e. thousands of ms
    // for 2000 lookups. Binary search must land far below that; generous
    // 300ms ceiling leaves headroom for slow CI runners while still failing
    // hard if a regression reintroduces an O(n) scan.
    expect(elapsedMs).toBeLessThan(300);
  });
});

describe("plotApexY — unchanged sanity check (not part of P5, kept for module coverage)", () => {
  it("sums height + bg + baseline", () => {
    expect(plotApexY(10, 2, 3)).toBe(15);
  });
});
