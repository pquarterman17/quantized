import { describe, expect, it } from "vitest";

import { classifyLimChange } from "./plotLimApply";

describe("classifyLimChange", () => {
  it("no-ops when both prev and next are null (nothing committed)", () => {
    expect(classifyLimChange(null, null, undefined, undefined)).toBe("noop");
    expect(classifyLimChange(null, null, 0, 1)).toBe("noop");
  });

  it("rebuilds on a concrete -> null transition (autoscale restore)", () => {
    // usePlotStageActions.resetView / PlotContextMenu autoscale* / the "a"
    // shortcut / backView-forwardView landing on a null snapshot.
    expect(classifyLimChange([0, 10], null, 0, 10)).toBe("rebuild");
  });

  it("no-ops on a null -> concrete transition whose value already matches live (the hot path)", () => {
    // A zoom/pan gesture committed from a previously-autoscaled view: the
    // live scale already shows exactly `next` (viewHistoryPlugin's `after`
    // IS read from the live scale), so nothing further is needed.
    expect(classifyLimChange(null, [3, 7], 3, 7)).toBe("noop");
  });

  it("applies on a null -> concrete transition that differs from live", () => {
    // An Inspector value typed while autoscaled, or a workspace restore.
    expect(classifyLimChange(null, [5, 15], 0, 10)).toBe("apply");
  });

  it("applies on a concrete -> concrete transition that differs from live", () => {
    expect(classifyLimChange([0, 10], [0, 20], 0, 10)).toBe("apply");
  });

  it("no-ops on a concrete -> concrete transition unchanged and matching live", () => {
    expect(classifyLimChange([5, 10], [5, 10], 5, 10)).toBe("noop");
  });

  it("treats a relative-epsilon-close next as matching live (no-op)", () => {
    const live = 100.00000005; // ~5e-10 relative to 100 -- under the 1e-9 epsilon on both bounds
    expect(classifyLimChange([50, 100], [100, 200], live, 200 + 5e-8)).toBe("noop");
  });

  it("applies when next differs from live beyond the epsilon", () => {
    expect(classifyLimChange([100, 200], [100, 200], 100.001, 200)).toBe("apply");
  });

  it("handles zero-width ranges without dividing by zero", () => {
    expect(classifyLimChange([1, 2], [5, 5], 5, 5)).toBe("noop");
    expect(classifyLimChange([1, 2], [5, 5], 5, 6)).toBe("apply");
    expect(classifyLimChange([1, 2], [0, 0], 0, 0)).toBe("noop");
  });

  it("guards NaN/non-finite next bounds by falling back to rebuild", () => {
    expect(classifyLimChange([0, 10], [Number.NaN, 10], 0, 10)).toBe("rebuild");
    expect(classifyLimChange([0, 10], [10, Number.POSITIVE_INFINITY], 0, 10)).toBe("rebuild");
  });

  it("does not crash when live bounds are NaN/missing, and falls back to apply", () => {
    expect(classifyLimChange([0, 10], [1, 2], Number.NaN, Number.NaN)).toBe("apply");
    expect(classifyLimChange(null, [1, 2], null, null)).toBe("apply");
    expect(classifyLimChange(null, [1, 2], undefined, undefined)).toBe("apply");
  });
});
