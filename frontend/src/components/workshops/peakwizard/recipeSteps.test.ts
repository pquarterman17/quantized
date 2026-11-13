// Peak Analyzer step ① (audit #19): beside None / ALS / rolling ball /
// modpoly, the recipe runs the Baseline workshop's SNIP, anchor points,
// Shirley and polynomial methods on the SAME endpoints, and the anchor
// method anchors each dataset on its own data at the recipe's X positions.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  baselineAnchor,
  baselineEstimate,
  baselineRegion,
  baselineShirley,
} from "../../../lib/api/baseline";
import { DEFAULT_RECIPE, type PeakRecipe } from "../../../lib/peakwizard";
import { parseAnchorX } from "./StepRangeBaseline";
import { anchorsAt, recipeBaseline } from "./recipeSteps";

vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(async () => ({ baseline: [0] })),
  baselineRollingBall: vi.fn(async () => ({ baseline: [0] })),
  baselineModPoly: vi.fn(async () => ({ baseline: [0] })),
  baselineEstimate: vi.fn(async () => ({ baseline: [1, 1, 1] })),
  baselineShirley: vi.fn(async () => ({ baseline: [2, 2, 2] })),
  baselineAnchor: vi.fn(async () => ({ baseline: [3, 3, 3] })),
  baselineRegion: vi.fn(async () => ({ background: [4, 4, 4] })),
}));

const X = [10, 20, 30];
const Y = [5, 9, 7];
const b = (patch: Partial<PeakRecipe["baseline"]>): PeakRecipe["baseline"] => ({ ...DEFAULT_RECIPE.baseline, ...patch });

beforeEach(() => vi.clearAllMocks());

describe("recipeBaseline — the Baseline workshop's methods", () => {
  it("SNIP goes through /baseline/estimate with x", async () => {
    expect(await recipeBaseline(X, Y, b({ method: "snip" }))).toEqual([1, 1, 1]);
    expect(baselineEstimate).toHaveBeenCalledWith({ x: X, y: Y, method: "snip" });
  });

  it("Shirley sends its iteration cap (50 by default, the workshop's)", async () => {
    expect(await recipeBaseline(X, Y, b({ method: "shirley" }))).toEqual([2, 2, 2]);
    expect(baselineShirley).toHaveBeenLastCalledWith({ x: X, y: Y, max_iter: 50 });
    await recipeBaseline(X, Y, b({ method: "shirley", maxIter: 7 }));
    expect(baselineShirley).toHaveBeenLastCalledWith({ x: X, y: Y, max_iter: 7 });
  });

  it("anchor points sit on THIS trace's y at the nearest point", async () => {
    expect(await recipeBaseline(X, Y, b({ method: "anchor", anchorX: [31, 9], anchorMethod: "linear" }))).toEqual([3, 3, 3]);
    expect(baselineAnchor).toHaveBeenCalledWith({ x: X, y: Y, anchors: [[10, 5], [30, 7]], method: "linear" });
  });

  it("anchor points need two distinct anchors", async () => {
    await expect(recipeBaseline(X, Y, b({ method: "anchor", anchorX: [11, 12] }))).rejects.toThrow(/at least two/);
    expect(baselineAnchor).not.toHaveBeenCalled();
  });

  it("the polynomial fits the full working range at the recipe's order", async () => {
    expect(await recipeBaseline(X, Y, b({ method: "poly", order: 3 }))).toEqual([4, 4, 4]);
    expect(baselineRegion).toHaveBeenCalledWith({ x: X, y: Y, x_min: 10, x_max: 30, order: 3 });
  });

  it("none is no baseline", async () => {
    expect(await recipeBaseline(X, Y, b({ method: "none" }))).toBeNull();
  });
});

describe("anchor helpers", () => {
  it("skips non-finite points and de-duplicates anchors on one point", () => {
    expect(anchorsAt([0, 1, Number.NaN, 3], [1, 2, 3, 4], [0.9, 1.2, 2.1])).toEqual([[1, 2], [3, 4]]);
  });

  it("parses typed X positions, refusing anything not a number", () => {
    expect(parseAnchorX("10, 25.5; 40")).toEqual([10, 25.5, 40]);
    expect(parseAnchorX("10, abc")).toBeNull();
    expect(parseAnchorX("")).toEqual([]);
  });
});
