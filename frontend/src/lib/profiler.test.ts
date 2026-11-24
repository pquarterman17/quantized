import { describe, expect, it } from "vitest";

import type { ProfilerModel } from "./api/modelEvaluate";
import {
  clamp, contourLevels, contourSegments, defaultSettings, outsideLimits, profilerFactors, profilerProblem, sliderStep,
} from "./profiler";

const model = {
  response: "y",
  factors: [{ name: "T", kind: "continuous", mean: 600 }, { name: "g", kind: "nominal", levels: ["a", "b"] }, { name: "unused", kind: "continuous", mean: 1 }],
  terms: [["T"], ["g"]], center_polynomials: true, parameters: [], coefficients: [], covariance: [], df_error: 5, rmse: 1,
  ranges: { T: [300, 900] },
} as unknown as ProfilerModel;

describe("profiler helpers", () => {
  it("lists only the factors the terms use, with defaults at mean / averaged", () => {
    expect(profilerFactors(model).map((f) => f.name)).toEqual(["T", "g"]);
    expect(defaultSettings(model)).toEqual({ T: 600, g: null });
    expect(profilerProblem(model)).toBeNull();
  });
  it("refuses a model without a stored range (older saved results)", () => {
    const { ranges: _ranges, ...old } = model;
    expect(profilerProblem(old as ProfilerModel)).toMatch(/Fit Model again/);
  });
  it("clamps and picks a readable slider step", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(sliderStep(300, 900)).toBe(3);
    expect(sliderStep(1, 1)).toBe(1);
  });
  it("flags values outside the response limits", () => {
    expect(outsideLimits(5, 6, null)).toBe(true);
    expect(outsideLimits(5, null, 4)).toBe(true);
    expect(outsideLimits(5, 1, 9)).toBe(false);
    expect(outsideLimits(5, null, null)).toBe(false);
  });
});

describe("contourSegments", () => {
  // z = x + y on a unit grid: the level-1 contour is the anti-diagonal.
  const x = [0, 1, 2], y = [0, 1, 2];
  const z = y.map((yy) => x.map((xx) => xx + yy));
  it("traces z = x + y = 1 exactly", () => {
    const segs = contourSegments(x, y, z, 1);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.x1 + s.y1).toBeCloseTo(1, 12);
      expect(s.x2 + s.y2).toBeCloseTo(1, 12);
    }
  });
  it("has no segment at a level outside the data and levels sit inside the range", () => {
    expect(contourSegments(x, y, z, 10)).toEqual([]);
    const lv = contourLevels(z, 3);
    expect(lv).toHaveLength(3);
    expect(lv.every((v) => v > 0 && v < 4)).toBe(true);
    expect(contourLevels([[2, 2], [2, 2]])).toEqual([]);
  });
});
