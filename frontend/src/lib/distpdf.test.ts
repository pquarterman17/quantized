import { describe, expect, it } from "vitest";

import { DIST_FAMILIES, distPdf, distPdfCurve, gammaFn, pdfOverlayPoints } from "./distpdf";

describe("gammaFn", () => {
  it("matches known Γ values", () => {
    expect(gammaFn(1)).toBeCloseTo(1, 9);
    expect(gammaFn(2)).toBeCloseTo(1, 9);
    expect(gammaFn(5)).toBeCloseTo(24, 6); // Γ(n) = (n-1)!
    expect(gammaFn(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 9);
    expect(gammaFn(3.5)).toBeCloseTo(3.3233509704478426, 6);
  });
});

describe("distPdf", () => {
  it("normal: standard normal pdf at 0 is 1/sqrt(2π)", () => {
    expect(distPdf("normal", { mu: 0, sigma: 1 }, 0)).toBeCloseTo(0.3989422804, 8);
    // symmetric about mu
    expect(distPdf("normal", { mu: 5, sigma: 2 }, 5)).toBeCloseTo(
      distPdf("normal", { mu: 0, sigma: 2 }, 0),
      9,
    );
  });

  it("exponential: pdf(0)=rate, decays as exp(-rate x); 0 outside support", () => {
    expect(distPdf("exponential", { rate: 1 }, 0)).toBeCloseTo(1, 9);
    expect(distPdf("exponential", { rate: 1 }, 1)).toBeCloseTo(Math.exp(-1), 9);
    expect(distPdf("exponential", { rate: 2 }, -1)).toBe(0);
  });

  it("gamma(shape=1, scale=theta) reduces to exponential(rate=1/theta)", () => {
    const theta = 2;
    for (const x of [0.1, 1, 3]) {
      expect(distPdf("gamma", { shape: 1, scale: theta }, x)).toBeCloseTo(
        distPdf("exponential", { rate: 1 / theta }, x),
        6,
      );
    }
    expect(distPdf("gamma", { shape: 2, scale: 1 }, 0)).toBe(0); // x<=0 outside support
  });

  it("weibull(shape=1, scale=lambda) reduces to exponential(rate=1/lambda)", () => {
    const lambda = 3;
    for (const x of [0, 0.5, 2]) {
      expect(distPdf("weibull", { shape: 1, scale: lambda }, x)).toBeCloseTo(
        distPdf("exponential", { rate: 1 / lambda }, x),
        6,
      );
    }
  });

  it("lognormal: pdf at x=1 with mu=0 matches the standard-normal constant", () => {
    expect(distPdf("lognormal", { mu: 0, sigma: 1 }, 1)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 8);
    expect(distPdf("lognormal", { mu: 0, sigma: 1 }, 0)).toBe(0); // x<=0 outside support
    expect(distPdf("lognormal", { mu: 0, sigma: 1 }, -1)).toBe(0);
  });

  it("returns NaN for a non-positive scale/sigma parameter", () => {
    expect(Number.isNaN(distPdf("normal", { mu: 0, sigma: 0 }, 0))).toBe(true);
    expect(Number.isNaN(distPdf("gamma", { shape: 1, scale: -1 }, 1))).toBe(true);
  });
});

describe("distPdfCurve", () => {
  it("samples n points evenly over [xMin, xMax]", () => {
    const c = distPdfCurve("normal", { mu: 0, sigma: 1 }, -2, 2, 5);
    expect(c.x).toEqual([-2, -1, 0, 1, 2]);
    expect(c.y).toHaveLength(5);
    expect(c.y[2]).toBeCloseTo(0.3989422804, 6); // peak at x=0
  });

  it("returns empty arrays for a degenerate domain", () => {
    expect(distPdfCurve("normal", { mu: 0, sigma: 1 }, 5, 5)).toEqual({ x: [], y: [] });
    expect(distPdfCurve("normal", { mu: 0, sigma: 1 }, 5, 1)).toEqual({ x: [], y: [] });
  });

  it("DIST_FAMILIES lists exactly the 5 curated families", () => {
    expect(DIST_FAMILIES).toEqual(["normal", "lognormal", "weibull", "gamma", "exponential"]);
  });
});

describe("pdfOverlayPoints", () => {
  it("builds a points string spanning 0–100% in both axes", () => {
    const curve = { x: [0, 5, 10], y: [0, 1, 0] };
    const points = pdfOverlayPoints(curve, { lo: 0, hi: 10 }, 1, 10, 10);
    const parts = points.split(" ").map((p) => p.split(",").map(Number));
    expect(parts).toHaveLength(3);
    expect(parts[0][0]).toBeCloseTo(0, 3); // x=0 -> 0%
    expect(parts[2][0]).toBeCloseTo(100, 3); // x=10 -> 100%
    // peak (y=1, count = 1*10*1 = 10 = maxCount) -> yPct=100 -> svg y = 0 (top)
    expect(parts[1][1]).toBeCloseTo(0, 3);
  });

  it("returns an empty string for a degenerate domain or empty curve", () => {
    expect(pdfOverlayPoints({ x: [], y: [] }, { lo: 0, hi: 1 }, 1, 10, 10)).toBe("");
    expect(pdfOverlayPoints({ x: [1], y: [1] }, { lo: 1, hi: 1 }, 1, 10, 10)).toBe("");
    expect(pdfOverlayPoints({ x: [1], y: [1] }, { lo: 0, hi: 1 }, 1, 10, 0)).toBe("");
  });

  it("clamps a count that overshoots maxCount to 100%", () => {
    const curve = { x: [0], y: [10] }; // count = 10*10*1 = 100, way over maxCount=1
    const points = pdfOverlayPoints(curve, { lo: 0, hi: 1 }, 1, 10, 1);
    const [, y] = points.split(",").map(Number);
    expect(y).toBeCloseTo(0, 3); // clamped to top
  });
});
