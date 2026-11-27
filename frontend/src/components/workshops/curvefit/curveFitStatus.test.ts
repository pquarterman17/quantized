import { describe, expect, it } from "vitest";

import { curveFitStatus, fittedStatus, isLinearFamily, poorFit, runsTestP, type FitStatusInput } from "./curveFitStatus";

const base: FitStatusInput = { hasData: true, busy: false, error: null, result: null, guessOnly: false, stale: false, byLevels: 0 };
const fit = { params: [1, 2], R2: 0.99871, chiSqRed: 1.0234, exitFlag: 1 };

describe("Curve Fit header status (UX-F)", () => {
  it("names each state in words", () => {
    expect(curveFitStatus({ ...base, hasData: false }).text).toBe("Select a dataset to fit");
    expect(curveFitStatus(base).text).toBe("Not fitted yet");
    expect(curveFitStatus({ ...base, busy: true }).text).toBe("Fitting…");
    expect(curveFitStatus({ ...base, busy: true, guessing: true }).text).toBe("Guessing start values…");
    expect(curveFitStatus({ ...base, error: "boom" })).toEqual({ text: "Failed — boom", tone: "danger" });
    // The reason is the first non-empty line, bounded; an empty message keeps the pointer.
    expect(curveFitStatus({ ...base, error: "\n eta must be in [0, 1]\nsecond line" }).text).toBe("Failed — eta must be in [0, 1]");
    expect(curveFitStatus({ ...base, error: "x".repeat(400) }).text).toHaveLength("Failed — ".length + 160);
    expect(curveFitStatus({ ...base, error: "  " }).text).toBe("Failed — see the message below");
    expect(curveFitStatus({ ...base, error: "x".repeat(40) }).detail).toBeUndefined();
  });

  it("shortens the too-few-points refusal to its key fact and keeps the full sentence as the tooltip", () => {
    const full = "10 parameters need at least 10 points; 3 are selected";
    const st = curveFitStatus({ ...base, error: full });
    expect(st).toEqual({ text: "Failed — needs ≥10 points (3 selected); see Results", tone: "danger", detail: `Failed — ${full}` });
    expect(st.text.length).toBeLessThan(55);
    expect(curveFitStatus({ ...base, error: `${full}
more detail` }).detail).toBe(`Failed — ${full}`);
    expect(curveFitStatus({ ...base, result: fit, guessOnly: true }).text).toBe("Start values guessed — press Fit");
    expect(curveFitStatus({ ...base, byLevels: 3, byBusy: true }).text).toBe("Fitting 3 levels…");
    expect(curveFitStatus({ ...base, byLevels: 3 }).text).toBe("3 per-level fits — see Results");
  });

  it("shows the headline statistics of a finished fit", () => {
    expect(curveFitStatus({ ...base, result: fit })).toEqual({ text: "R² 0.99871 · χ²/dof 1.02", tone: "ok" });
  });

  it("a line fit on errors in x and y stands in for the model fit; a model fit still wins", () => {
    expect(curveFitStatus({ ...base, lineFit: { method: "York", stale: false } })).toEqual({ text: "York line fit done — see Advanced", tone: "ok" });
    expect(curveFitStatus({ ...base, lineFit: { method: "ODR", stale: true } }).tone).toBe("warn");
    expect(curveFitStatus({ ...base, result: fit, lineFit: { method: "York", stale: false } }).text).toBe("R² 0.99871 · χ²/dof 1.02");
  });

  it("flags a stale or non-converged fit", () => {
    expect(curveFitStatus({ ...base, result: fit, stale: true }).tone).toBe("warn");
    expect(curveFitStatus({ ...base, result: { ...fit, exitFlag: 0 } })).toEqual({ text: "Did not converge — see Results", tone: "danger" });
  });
});

// A fixed pseudo-random stream (Park-Miller) and standard normals from it.
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function normals(n: number, seed: number): number[] {
  const u = rng(seed);
  return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
}
/** AR(1) noise: e[i] = phi e[i-1] + white -- a smoothed or oversampled scan. */
function ar1(n: number, phi: number, seed: number): number[] {
  const w = normals(n, seed);
  const out: number[] = [];
  w.forEach((v, i) => out.push(i === 0 ? v : phi * out[i - 1]! + v));
  return out;
}

// UX audit 8 #5: Lorentzian over a whole 3-peak Raman spectrum converged on one
// broad hump at R² 0.185 and the status read green.
describe("a converged but poor fit reads warn (UX8-D)", () => {
  const alternating = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1) * (1 + (i % 7) / 10));
  const noise = normals(400, 7);

  it("R² below 0.5 is a poor fit, whatever the residuals", () => {
    const r = { ...fit, R2: 0.187, residuals: noise };
    expect(curveFitStatus({ ...base, result: r })).toEqual({ text: "Fitted — poor fit (R² 0.19); try a range", tone: "warn" });
    expect(poorFit(r)).toBe("R² 0.19");
  });

  it("a linear fit with no significant trend is a right answer at low R², a real trend is not", () => {
    const flat = { ...fit, R2: 0.001, nPoints: 500, nFree: 2, residuals: noise }; // F = 0.5
    expect(poorFit(flat, { linear: true })).toBeNull();
    expect(poorFit(flat)).toBe("R² 0.001"); // a nonlinear model gets no such pass
    // Linear on the audit's M(T): R² 0.106 over 500 points -- F = 59, a trend it misses.
    expect(poorFit({ ...flat, R2: 0.106 }, { linear: true })).toBe("R² 0.11");
    expect(isLinearFamily("Linear")).toBe(true);
    expect(isLinearFamily("Polynomial")).toBe(true);
    expect(isLinearFamily("Peak")).toBe(false);
  });

  it("the runs test counts only below R² 0.9: correlated noise under the RIGHT model fails it alone", () => {
    // 2000 points of AR(0.3) noise, the correct model: R² 0.998, runs p ~1e-19.
    const correlated = ar1(2000, 0.3, 11);
    const p = runsTestP(correlated)!;
    expect(p).toBeLessThan(1e-6);
    expect(curveFitStatus({ ...base, result: { ...fit, R2: 0.998, residuals: correlated } }).tone).toBe("ok");
    // Stronger correlation (oversampled), still a good fit: still no warning.
    expect(poorFit({ ...fit, R2: 0.95, residuals: ar1(5000, 0.9, 3) })).toBeNull();
  });

  it("long one-sign stretches at a middling R² are a misfit", () => {
    // A straight line through a curved M(T): positive, negative, positive.
    const humped = Array.from({ length: 300 }, (_, i) => Math.cos((i / 300) * 2 * Math.PI) + 0.01 * noise[i]!);
    expect(runsTestP(humped)!).toBeLessThan(1e-10);
    const status = curveFitStatus({ ...base, result: { ...fit, R2: 0.85, residuals: humped } });
    expect(status.tone).toBe("warn");
    expect(status.text).toMatch(/^Fitted — poor fit \(R² 0\.85, residual runs p .+\); try a range$/);
  });

  it("random residuals pass; the statistic matches calc/fit_stats.py", () => {
    expect(runsTestP(noise)!).toBeGreaterThan(0.01);
    expect(curveFitStatus({ ...base, result: { ...fit, R2: 0.8, residuals: noise } }).tone).toBe("ok");
    // 6 values, signs + + - + - -: 4 runs, n+ = n- = 3 -> mu 4, z 0, p 1.
    expect(runsTestP([1, 2, -1, 0, -3, -2])).toBeCloseTo(1, 12);
    // too many runs is as unlikely as too few (two-sided)
    expect(runsTestP(alternating)!).toBeLessThan(0.01);
  });

  it("drops zero-weight points and reads a missing residual as negative, as residual_diagnostics does", () => {
    const r = [1, 2, -1, 0, -3, -2];
    // A zero (or NaN) weight removes the point; the rest is the 5-point series.
    expect(runsTestP([...r, 9], [1, 1, 1, 1, 1, 1, 0])).toBe(runsTestP(r));
    expect(runsTestP([9, ...r], [Number.NaN, 1, 1, 1, 1, 1, 1])).toBe(runsTestP(r));
    // np.asarray turns None into NaN, and NaN >= 0 is False: a negative sign.
    expect(runsTestP([1, null, 1, Number.NaN, 1, "x"])).toBe(runsTestP([1, -1, 1, -1, 1, -1]));
    // Weights of another length (not this fit's) are ignored, not misapplied.
    expect(runsTestP(r, [0, 0])).toBe(runsTestP(r));
  });

  it("is undefined without both signs or with too few residuals", () => {
    expect(runsTestP([1, 2, 3])).toBeNull();
    expect(runsTestP([1, -1])).toBeNull();
  });

  it("the app status line says so in warn tone", () => {
    expect(fittedStatus("Lorentzian", "Raman", { ...fit, R2: 0.187 })).toEqual([
      "fitted Lorentzian to Raman — poor fit (R² 0.19); try a range",
      "warn",
    ]);
    expect(fittedStatus("Linear", "run.dat", fit)).toEqual(["fitted Linear to run.dat", "ok"]);
  });
});
