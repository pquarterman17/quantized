import { describe, expect, it } from "vitest";

import { curveFitStatus, fittedStatus, poorFit, runsTestP, type FitStatusInput } from "./curveFitStatus";

const base: FitStatusInput = { hasData: true, busy: false, error: null, result: null, guessOnly: false, stale: false, byLevels: 0 };
const fit = { params: [1, 2], R2: 0.99871, chiSqRed: 1.0234, exitFlag: 1 };

describe("Curve Fit header status (UX-F)", () => {
  it("names each state in words", () => {
    expect(curveFitStatus({ ...base, hasData: false }).text).toBe("Select a dataset to fit");
    expect(curveFitStatus(base).text).toBe("Not fitted yet");
    expect(curveFitStatus({ ...base, busy: true }).text).toBe("Fitting…");
    expect(curveFitStatus({ ...base, busy: true, guessing: true }).text).toBe("Guessing start values…");
    expect(curveFitStatus({ ...base, error: "boom" })).toEqual({ text: "Failed — see the message below", tone: "danger" });
    expect(curveFitStatus({ ...base, result: fit, guessOnly: true }).text).toBe("Start values guessed — press Fit");
    expect(curveFitStatus({ ...base, byLevels: 3, byBusy: true }).text).toBe("Fitting 3 levels…");
    expect(curveFitStatus({ ...base, byLevels: 3 }).text).toBe("3 per-level fits — see Results");
  });

  it("shows the headline statistics of a finished fit", () => {
    expect(curveFitStatus({ ...base, result: fit })).toEqual({ text: "R² 0.99871 · χ²/dof 1.02", tone: "ok" });
  });

  it("flags a stale or non-converged fit", () => {
    expect(curveFitStatus({ ...base, result: fit, stale: true }).tone).toBe("warn");
    expect(curveFitStatus({ ...base, result: { ...fit, exitFlag: 0 } })).toEqual({ text: "Did not converge — see Results", tone: "danger" });
  });
});

// UX audit 8 #5: Lorentzian over a whole 3-peak Raman spectrum converged on one
// broad hump at R² 0.185 and the status read green.
describe("a converged but poor fit reads warn (UX8-D)", () => {
  const alternating = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1) * (1 + (i % 7) / 10));
  // Residual signs of a random draw: a fixed pseudo-random sequence.
  let seed = 7;
  const noise = Array.from({ length: 400 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5);

  it("R² below 0.5 is a poor fit, whatever the residuals", () => {
    const r = { ...fit, R2: 0.187, residuals: noise };
    expect(curveFitStatus({ ...base, result: r })).toEqual({ text: "Fitted — poor fit (R² 0.19); try a range", tone: "warn" });
    expect(poorFit(r)).toBe("R² 0.19");
  });

  it("residuals that keep one sign over long stretches fail the runs test", () => {
    // A straight line through a curved M(T): positive, negative, positive.
    const humped = Array.from({ length: 300 }, (_, i) => Math.cos((i / 300) * 2 * Math.PI) + 0.01 * noise[i]!);
    const p = runsTestP(humped)!;
    expect(p).toBeLessThan(1e-10);
    const status = curveFitStatus({ ...base, result: { ...fit, R2: 0.93, residuals: humped } });
    expect(status.tone).toBe("warn");
    expect(status.text).toMatch(/^Fitted — poor fit \(residual runs p .+\); try a range$/);
  });

  it("random residuals pass; the statistic matches calc/fit_stats.py", () => {
    expect(runsTestP(noise)!).toBeGreaterThan(0.01);
    expect(curveFitStatus({ ...base, result: { ...fit, residuals: noise } }).tone).toBe("ok");
    // 6 values, signs + + - + - -: 4 runs, n+ = n- = 3 -> mu 4, z 0, p 1.
    expect(runsTestP([1, 2, -1, 0, -3, -2])).toBeCloseTo(1, 12);
    // too many runs is as unlikely as too few (two-sided)
    expect(runsTestP(alternating)!).toBeLessThan(0.01);
  });

  it("is undefined without both signs or with too few residuals", () => {
    expect(runsTestP([1, 2, 3])).toBeNull();
    expect(runsTestP([1, -1])).toBeNull();
    expect(runsTestP([1, null, "x", -1])).toBeNull();
  });

  it("the app status line says so in warn tone", () => {
    expect(fittedStatus("Lorentzian", "Raman", { ...fit, R2: 0.187 })).toEqual([
      "fitted Lorentzian to Raman — poor fit (R² 0.19); try a range",
      "warn",
    ]);
    expect(fittedStatus("Linear", "run.dat", fit)).toEqual(["fitted Linear to run.dat", "ok"]);
  });
});
