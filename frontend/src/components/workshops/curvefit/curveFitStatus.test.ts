import { describe, expect, it } from "vitest";

import { curveFitStatus, type FitStatusInput } from "./curveFitStatus";

const base: FitStatusInput = { hasData: true, busy: false, error: null, result: null, guessOnly: false, stale: false, byLevels: 0 };
const fit = { params: [1, 2], R2: 0.99871, chiSqRed: 1.0234, exitFlag: 1 };

describe("Curve Fit header status (UX-F)", () => {
  it("names each state in words", () => {
    expect(curveFitStatus({ ...base, hasData: false }).text).toBe("Select a dataset to fit");
    expect(curveFitStatus(base).text).toBe("Not fitted yet");
    expect(curveFitStatus({ ...base, busy: true }).text).toBe("Fitting…");
    expect(curveFitStatus({ ...base, error: "boom" })).toEqual({ text: "Failed — see the message below", tone: "danger" });
    expect(curveFitStatus({ ...base, result: fit, guessOnly: true }).text).toBe("Start values guessed — press Fit");
    expect(curveFitStatus({ ...base, byLevels: 3, byBusy: true }).text).toBe("Fitting 3 levels…");
    expect(curveFitStatus({ ...base, byLevels: 3 }).text).toBe("3 per-level fits — see Results");
  });

  it("shows the headline statistics of a finished fit", () => {
    expect(curveFitStatus({ ...base, result: fit })).toEqual({ text: "R² 0.99871 · χ²ᵣ 1.02", tone: "ok" });
  });

  it("flags a stale or non-converged fit", () => {
    expect(curveFitStatus({ ...base, result: fit, stale: true }).tone).toBe("warn");
    expect(curveFitStatus({ ...base, result: { ...fit, exitFlag: 0 } })).toEqual({ text: "Did not converge — see Results", tone: "danger" });
  });
});
