import { describe, expect, it } from "vitest";

import { tCritical95, tCriticalTwoSided } from "./tdist";

// Oracle: python -c "from scipy import stats as sps
// for df in [1,2,5,9,10,30,100,120,1000]: print(df, sps.t.ppf(0.975, df))"
describe("tCritical95 (vs scipy.stats.t.ppf(0.975, df) oracle)", () => {
  const oracle: [number, number][] = [
    [1, 12.706204736174694],
    [2, 4.302652729749462],
    [5, 2.5705818356363146],
    [9, 2.262157162798205],
    [10, 2.228138851986274],
    [30, 2.0422724563012378],
    [100, 1.9839715185235518],
    [120, 1.9799304050824402],
    [1000, 1.9623390808264083],
  ];

  it.each(oracle)("df=%i matches scipy to 1e-6", (df, expected) => {
    expect(tCritical95(df)).toBeCloseTo(expected, 6);
  });

  it("converges toward the normal 1.95996 limit for very large df", () => {
    expect(tCritical95(1e6)).toBeCloseTo(1.959963984540054, 3);
  });
});

describe("tCriticalTwoSided", () => {
  it("alpha=0.05 is the same as tCritical95", () => {
    expect(tCriticalTwoSided(10, 0.05)).toBe(tCritical95(10));
  });

  it("a smaller alpha (wider CI) yields a larger critical value", () => {
    expect(tCriticalTwoSided(10, 0.01)).toBeGreaterThan(tCriticalTwoSided(10, 0.05));
  });

  it("returns NaN for a degenerate df", () => {
    expect(Number.isNaN(tCriticalTwoSided(0))).toBe(true);
    expect(Number.isNaN(tCriticalTwoSided(-1))).toBe(true);
  });
});
