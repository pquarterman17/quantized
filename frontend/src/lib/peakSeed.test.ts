// Direct add (audit P2.4 slice 3): a peak added at a clicked x is seeded from
// the data around it — snapped apex, half-maximum FWHM — not a flat guess.

import { describe, expect, it } from "vitest";

import { seedPeakNear } from "./peakSeed";

// 0..20 step 0.05 (401 points): a Gaussian at 8 (FWHM 0.6, height 100) and a
// Lorentzian at 14 (FWHM 1.0, height 40) on a background of 10.
const X = Array.from({ length: 401 }, (_, i) => i * 0.05);
const gauss = (x: number, c: number, w: number, h: number) => h * Math.exp(-4 * Math.LN2 * ((x - c) / w) ** 2);
const lor = (x: number, c: number, w: number, h: number) => h / (1 + ((2 * (x - c)) / w) ** 2);
const Y = X.map((x) => 10 + gauss(x, 8, 0.6, 100) + lor(x, 14, 1, 40));

describe("seedPeakNear", () => {
  it("snaps a slightly-off click onto the apex and measures the FWHM at half maximum", () => {
    const s = seedPeakNear(X, Y, 8.12)!;
    expect(s.center).toBe(8);
    expect(s.height).toBe(Y[160]); // the apex sample (x = 8): 110 + the Lorentzian's tail
    expect(s.fwhm).toBeGreaterThan(0.55);
    expect(s.fwhm).toBeLessThan(0.65);
  });

  it("measures a Lorentzian's width the same way", () => {
    const s = seedPeakNear(X, Y, 13.9)!;
    expect(s.center).toBe(14);
    expect(s.fwhm).toBeGreaterThan(0.85);
    expect(s.fwhm).toBeLessThan(1.15);
  });

  it("keeps the clicked x on a slope (a shoulder), not the bigger neighbour's apex", () => {
    const s = seedPeakNear(X, Y, 7.3)!; // on the Gaussian's rising flank
    expect(s.center).toBe(7.3);
    expect(s.height).toBeCloseTo(Y[146], 6); // the nearest sample (x = 7.3)
  });

  it("is order-free (a swept-back trace), skips non-finite points, and falls back on flat data", () => {
    const rev = seedPeakNear([...X].reverse(), [...Y].reverse(), 8.12)!;
    expect(rev.center).toBe(8);
    const gappy = seedPeakNear([...X, Number.NaN], [...Y, 5], 8)!;
    expect(gappy.center).toBe(8);
    const flat = seedPeakNear([0, 1, 2, 3], [5, 5, 5, 5], 1)!;
    expect(flat).toEqual({ center: 1, height: 5, fwhm: 3 / 50 });
    expect(seedPeakNear([], [], 1)).toBeNull();
  });

  it("never returns a width above the x range", () => {
    const s = seedPeakNear([0, 1, 2], [0, 10, 0], 1)!;
    expect(s.fwhm).toBeLessThanOrEqual(2);
    expect(s.fwhm).toBeGreaterThan(0);
  });
});
