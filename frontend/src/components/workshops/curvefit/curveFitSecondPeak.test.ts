// u14: a poor single-peak fit whose residuals hold two separate humps (a K-alpha doublet fitted with one
// peak) also suggests a 2-peak model, with the real menu path. Conservative: only for peak models, and
// never for one-hump, noise-only or non-peak residuals.
import { describe, expect, it } from "vitest";

import { hasSecondResidualMaximum, SECOND_PEAK_HINT } from "./curveFitSecondPeak";
import { curveFitStatus, fittedStatus, type FitStatusInput } from "./curveFitStatus";

function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
}
const gauss = (x: number, c: number, w: number): number => Math.exp(-0.5 * ((x - c) / w) ** 2);

/** The least-squares single Gaussian (centre and width on a grid, amplitude closed-form): what Fit returns. */
function singleGaussianFit(x: number[], y: number[]): { residuals: number[]; R2: number } {
  let best = { sse: Infinity, res: [] as number[] };
  for (let c = 20; c <= 80; c += 0.5) {
    for (let w = 2; w <= 30; w += 0.5) {
      const g = x.map((v) => gauss(v, c, w));
      const a = g.reduce((s, v, i) => s + v * y[i]!, 0) / g.reduce((s, v) => s + v * v, 0);
      const res = y.map((v, i) => v - a * g[i]!);
      const sse = res.reduce((s, v) => s + v * v, 0);
      if (sse < best.sse) best = { sse, res };
    }
  }
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  return { residuals: best.res, R2: 1 - best.sse / y.reduce((s, v) => s + (v - mean) ** 2, 0) };
}

const x = Array.from({ length: 200 }, (_, i) => i * 0.5);
const noise = lcg(5);
// Cu K-alpha: the second line half as strong, a few widths away.
const doublet = x.map((v) => gauss(v, 40, 3) + 0.5 * gauss(v, 56, 3) + 0.01 * noise());
const single = x.map((v) => gauss(v, 50, 6) + 0.01 * noise());
const base: FitStatusInput = { hasData: true, busy: false, error: null, result: null, guessOnly: false, stale: false, byLevels: 0 };
const asResult = (f: { residuals: number[]; R2: number }) => ({ params: [1, 40, 3], R2: f.R2, chiSqRed: 4, exitFlag: 1, residuals: f.residuals });

describe("a second maximum in the residuals (u14)", () => {
  const dFit = singleGaussianFit(x, doublet);

  it("sees the second line a one-peak fit of a doublet leaves behind", () => {
    expect(dFit.R2).toBeLessThan(0.9);
    expect(hasSecondResidualMaximum(dFit.residuals)).toBe(true);
  });

  it("does not see one for a clean single peak, noise, a wing or shape mismatch, an offset, or too few points", () => {
    // Shape mismatches swing both ways (wings of a broad component; a Lorentzian read as a Gaussian).
    expect(hasSecondResidualMaximum(singleGaussianFit(x, x.map((v) => gauss(v, 50, 6) + 0.6 * gauss(v, 50, 14))).residuals)).toBe(false);
    expect(hasSecondResidualMaximum(singleGaussianFit(x, x.map((v) => 1 / (1 + ((v - 50) / 4) ** 2))).residuals)).toBe(false);
    // A broad positive offset is not a peak.
    expect(hasSecondResidualMaximum(x.map((v) => (v > 20 && v < 90 ? 0.3 : 0) + 0.01 * noise()))).toBe(false);
    expect(hasSecondResidualMaximum(singleGaussianFit(x, single).residuals)).toBe(false);
    expect(hasSecondResidualMaximum(x.map(() => 0.1 * noise()))).toBe(false);
    expect(hasSecondResidualMaximum(dFit.residuals.slice(0, 20))).toBe(false);
  });

  it("the poor-fit status appends the suggestion, with the real menu path, for a peak model only", () => {
    const result = { ...asResult(dFit), R2: 0.45 }; // a poor R2, as the doublet fit reads over a wide window
    const peak = curveFitStatus({ ...base, result, context: { peak: true } });
    expect(peak.tone).toBe("warn");
    expect(peak.text).toMatch(/^Fitted — poor fit \(R² 0\.\d+.*\); try a range or a 2-peak model \(Analyze › Peaks & baseline › Find peaks…\)$/);
    expect(peak.text.endsWith(SECOND_PEAK_HINT)).toBe(true);
    // Not a peak model (a line through a doublet): the old wording, unchanged.
    expect(curveFitStatus({ ...base, result, context: { peak: false } }).text).toMatch(/; try a range$/);
    expect(curveFitStatus({ ...base, result }).text).toMatch(/; try a range$/);
    // The app status line says the same.
    expect(fittedStatus("Gaussian", "yig.raw", result, { peak: true })[0]).toContain("2-peak model");
  });

  it("a poor fit whose residuals are a shape mismatch keeps the old wording", () => {
    const f = singleGaussianFit(x, x.map((v) => gauss(v, 50, 6) + 0.6 * gauss(v, 50, 14)));
    const result = asResult({ ...f, R2: 0.4 });
    expect(curveFitStatus({ ...base, result, context: { peak: true } }).text).toBe("Fitted — poor fit (R² 0.4); try a range");
  });
});
